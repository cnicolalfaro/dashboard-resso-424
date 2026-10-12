import json
import multiprocessing
import resource
import time
from pathlib import Path

import cv2
import pymupdf as fitz
import numpy as np

from .documents import HEIGHT, WIDTH, valid_payload
from .storage import write_private


MAX_PAGES = 25
MAX_PIXELS = 12_000_000
RASTER_DPI = 150
SCAN_SECONDS = 45
WORKER_MEMORY_BYTES = 2 * 1024 * 1024 * 1024
SCALE = RASTER_DPI / 72


def unidentified(number, reason):
    return {"page": number, "record_id": None, "reason": reason, "rows": []}


def decode_page(image, secret, detectors):
    found = []
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)
    for variant in (gray, binary):
        for detector in detectors:
            success, texts, corners, _ = detector.detectAndDecodeMulti(variant)
            candidates = list(zip(texts, corners)) if success else []
            if not success:
                text, corner, _ = detector.detectAndDecode(variant)
                if text and corner is not None:
                    candidates = [(text, corner[0])]
            for text, corner in candidates:
                value = valid_payload(text, secret)
                if value is None:
                    continue
                center = np.mean(corner, axis=0)
                if not any(old_value == value and np.linalg.norm(np.mean(old_corner, axis=0) - center) < 15
                           for old_value, old_corner in found):
                    found.append((value, corner))
        if found:
            break
    return found


def register(image, page, qr_corners):
    source = np.asarray(qr_corners, dtype=np.float32)
    target = np.asarray(page["qr_corners"], dtype=np.float32) * SCALE
    approximate = cv2.getPerspectiveTransform(source, target)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    _, dark = cv2.threshold(gray, 65, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    expected_area = (10 * SCALE) ** 2
    for contour in contours:
        area = cv2.contourArea(contour)
        if not expected_area * 0.25 < area < expected_area * 4:
            continue
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, 0.04 * perimeter, True)
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if not 0.5 < w / h < 2 or area / (w * h) < 0.65:
            continue
        moments = cv2.moments(contour)
        center = np.array([[[moments["m10"] / moments["m00"], moments["m01"] / moments["m00"]]]],
                          dtype=np.float32)
        projected = cv2.perspectiveTransform(center, approximate)[0, 0]
        candidates.append((center[0, 0], projected))
    sources, targets = [], []
    for marker in page["markers"]:
        target_marker = np.array(marker, dtype=np.float32) * SCALE
        nearby = sorted(
            [(float(np.linalg.norm(projected - target_marker)), center)
             for center, projected in candidates
             if np.linalg.norm(projected - target_marker) < 100 * SCALE],
            key=lambda item: item[0],
        )
        if not nearby or (len(nearby) > 1 and nearby[1][0] - nearby[0][0] < 12 * SCALE):
            return None
        sources.append(nearby[0][1])
        targets.append(target_marker)
    if len({tuple(point) for point in sources}) != 4:
        return None
    width, height = page.get("size") or (WIDTH, HEIGHT)
    final = cv2.getPerspectiveTransform(np.asarray(sources, np.float32), np.asarray(targets, np.float32))
    corners = np.array([[[0, 0], [width * SCALE, 0], [width * SCALE, height * SCALE], [0, height * SCALE]]],
                       np.float32)
    inverse = cv2.perspectiveTransform(corners, np.linalg.inv(final))[0]
    ih, iw = image.shape[:2]
    # Even a small cropped edge is not accepted as complete evidence.
    if any(x < -3 or y < -3 or x > iw + 3 or y > ih + 3 for x, y in inverse):
        return None
    qr_registered = cv2.perspectiveTransform(source[None], final)[0]
    if np.max(np.linalg.norm(qr_registered - target, axis=1)) > 8 * SCALE:
        return None
    return cv2.warpPerspective(image, final, (round(width * SCALE), round(height * SCALE)),
                               borderValue=(255, 255, 255))


def color_present(image, box):
    x, y, w, h = [round(v * SCALE) for v in box]
    patch = image[y + 3:y + h - 3, x + 3:x + w - 3]
    if not patch.size:
        return False
    hsv = cv2.cvtColor(patch, cv2.COLOR_RGB2HSV)
    return np.mean((hsv[:, :, 1] > 80) & (hsv[:, :, 0] > 85) & (hsv[:, :, 0] < 125)) > 0.65


def suggestion(crop, row, has_color):
    if not has_color:
        return "REVISAR", "Escaneo gris o control de color no confiable"
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    mask = (((hsv[:, :, 0] < 12) | (hsv[:, :, 0] > 168)) &
            (hsv[:, :, 1] > 85) & (hsv[:, :, 2] > 70)).astype(np.uint8) * 255
    if np.count_nonzero(mask) < 6:
        return "FIRMO", "Sin trazo rojo de ausencia; la firma debe verificarse visualmente"
    # A horizontal red absence stroke must span from RUT into the signature cell.
    joined = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 5), np.uint8))
    count, _, stats, _ = cv2.connectedComponentsWithStats(joined)
    start = (row["rut_x"] - row["box"][0] + 12) * SCALE
    end = (row["signature_x"] - row["box"][0]) * SCALE
    strokes = []
    for x, y, w, h, area in stats[1:count]:
        if area < 6:
            continue
        if x <= start and x + w >= end and w > 12 * h and 2 < y and y + h < crop.shape[0] - 2:
            strokes.append((x, y, w, h, area))
    if len(strokes) == 1:
        stroke = strokes[0]
        if np.count_nonzero(mask) <= stroke[4] * 1.3:
            return "NO_FIRMO", "Trazo rojo horizontal RUT→FIRMA; requiere confirmación humana"
    return "REVISAR", "Marcas rojas ambiguas, múltiples o parciales"


def analyze(root, scan_id, pdf_path, manifests, secret):
    start = time.monotonic()
    detectors = [cv2.QRCodeDetector(), cv2.QRCodeDetectorAruco()]
    cv2.setNumThreads(1)
    pages, seen = [], set()
    with fitz.open(pdf_path) as document:
        if document.is_encrypted or not 1 <= len(document) <= MAX_PAGES:
            raise ValueError("Invalid PDF page count")
        total_pixels = 0
        for number, pdf_page in enumerate(document, 1):
            if time.monotonic() - start > SCAN_SECONDS - 2:
                raise ValueError("Scan processing timed out")
            width, height = pdf_page.rect.width * SCALE, pdf_page.rect.height * SCALE
            if width < 100 or height < 100 or width * height > MAX_PIXELS:
                raise ValueError("Raster size exceeds limit")
            total_pixels += width * height
            if total_pixels > 90_000_000:
                raise ValueError("Total raster size exceeds limit")
            pix = pdf_page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), colorspace=fitz.csRGB, alpha=False)
            image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
            recognized = decode_page(image, secret, detectors)
            if len(recognized) != 1:
                pages.append(unidentified(number, "Página sin un único QR NAMI válido"))
                continue
            (record_id, version, page_no, total), corner = recognized[0]
            manifest = manifests.get(record_id)
            if not manifest or version != manifest["version"] or total != len(manifest["pages"]) or not 1 <= page_no <= total:
                pages.append(unidentified(number, "Documento o versión no identificados"))
                continue
            if (record_id, page_no) in seen:
                pages.append(unidentified(number, "Página repetida o ambigua"))
                continue
            seen.add((record_id, page_no))
            template = manifest["pages"][page_no - 1]
            aligned = register(image, template, corner)
            if aligned is None:
                pages.append(unidentified(number, "Página recortada o alineación no confiable"))
                continue
            has_color = color_present(aligned, template["color_box"])
            rows = []
            for index, row in enumerate(template["rows"]):
                x, y, w, h = [round(v * SCALE) for v in row["box"]]
                crop = aligned[y:y + h, x:x + w]
                status, reason = suggestion(crop, row, has_color)
                row_id = f"{scan_id}-{number}-{index}"
                ok, png = cv2.imencode(".png", cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
                if not ok:
                    raise ValueError("Could not preserve preview")
                write_private(root / "rows" / f"{row_id}.png", png.tobytes())
                rows.append({"id": row_id, "rut": row["rut"], "nombre": row["nombre"],
                             "suggested": status, "reason": reason,
                             "image_url": f"/api/nami/scans/{scan_id}/rows/{row_id}/image"})
            pages.append({"page": number, "record_id": record_id, "document_page": page_no, "rows": rows})
    return pages


def worker(root, scan_id, pdf_path, manifests, secret, connection):
    try:
        resource.setrlimit(resource.RLIMIT_AS, (WORKER_MEMORY_BYTES, WORKER_MEMORY_BYTES))
        resource.setrlimit(resource.RLIMIT_CPU, (SCAN_SECONDS - 3, SCAN_SECONDS - 2))
        pages = analyze(Path(root), scan_id, pdf_path, manifests, secret)
        # Store output before signalling, avoiding large pipe writes/deadlocks.
        write_private(Path(root) / "scans" / f"{scan_id}.json", json.dumps(pages).encode())
        connection.send(True)
    except BaseException:
        connection.send(False)
    finally:
        connection.close()


def process_scan(root, scan_id, pdf_path, manifests, secret):
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=worker, args=(str(root), scan_id, str(pdf_path), manifests, secret, send))
    process.start()
    send.close()
    process.join(SCAN_SECONDS)
    if process.is_alive():
        process.terminate()
        process.join(3)
        if process.is_alive():
            process.kill()
            process.join()
        process.close()
        receive.close()
        raise ValueError("Scan timed out")
    try:
        succeeded = receive.poll() and receive.recv()
    except EOFError:
        succeeded = False
    finally:
        receive.close()
    exitcode = process.exitcode
    process.close()
    if not succeeded or exitcode != 0:
        raise ValueError("Invalid scan")
    result = root / "scans" / f"{scan_id}.json"
    try:
        return json.loads(result.read_text())
    finally:
        result.unlink(missing_ok=True)
