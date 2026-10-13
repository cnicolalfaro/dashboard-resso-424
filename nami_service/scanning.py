import json
import multiprocessing
import resource
import time
from pathlib import Path

import cv2
import pymupdf as fitz
import numpy as np

from .documents import HEIGHT, WIDTH, valid_evaluation_payload, valid_payload
from .evaluation_scan import find_person, read_evaluation, crops, tesseract_path
from .storage import write_private


MAX_PAGES = 150
MAX_PIXELS = 12_000_000
MAX_TOTAL_PIXELS = 400_000_000
RASTER_DPI = 150
SCAN_SECONDS = 900
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
                value = valid_payload(text, secret) or valid_evaluation_payload(text, secret)
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
    _, dark = cv2.threshold(gray, 110, 255, cv2.THRESH_BINARY_INV)
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
    # Markers sit 15 pt inside the page, so up to 8 pt of blank margin may be cut by the scanner.
    margin = 8 * SCALE
    if any(x < -margin or y < -margin or x > iw + margin or y > ih + margin for x, y in inverse):
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


def scan_has_color(image):
    """A color scan of even a black-and-white print has some color cast; a gray-mode scan has none."""
    spread = image.max(axis=2).astype(np.int16) - image.min(axis=2)
    return np.mean(spread >= 6) > 0.005


def suggestion(crop, row, has_color):
    if not has_color:
        return "REVISAR", "Escaneo gris o control de color no confiable"
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    mask = (((hsv[:, :, 0] < 12) | (hsv[:, :, 0] > 168)) &
            (hsv[:, :, 1] > 85) & (hsv[:, :, 2] > 70)).astype(np.uint8) * 255
    if np.count_nonzero(mask) < 6:
        return "FIRMO", "Sin trazo rojo de ausencia: se entiende que firmó"
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
            return "NO_FIRMO", "Trazo rojo horizontal RUT→FIRMA: no firmó"
    return "REVISAR", "Marcas rojas ambiguas, múltiples o parciales"


def save_preview(root, row_id, preview):
    ok, png = cv2.imencode(".png", preview)
    if not ok:
        raise ValueError("Could not preserve preview")
    write_private(root / "rows" / f"{row_id}.png", png.tobytes())


def evaluation_page(root, scan_id, number, preview, match, method):
    row_id = f"{scan_id}-{number}-eval"
    save_preview(root, row_id, preview)
    return {"page": number, "record_id": match["record_id"], "kind": "evaluation", "rows": [],
            "evaluation": {"rut": match["rut"], "nombre": match["nombre"], "code": match["code"],
                           "course_id": match["course_id"], "method": method},
            "preview_id": row_id,
            "preview_url": f"/api/nami/scans/{scan_id}/rows/{row_id}/image"}


def analyze(root, scan_id, pdf_path, manifests, secret):
    start = time.monotonic()
    detectors = [cv2.QRCodeDetector(), cv2.QRCodeDetectorAruco()]
    cv2.setNumThreads(1)
    pages, seen, seen_evaluations, read_later = [], set(), set(), []
    ocr = tesseract_path()
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
            if total_pixels > MAX_TOTAL_PIXELS:
                raise ValueError("Total raster size exceeds limit")
            pix = pdf_page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), colorspace=fitz.csRGB, alpha=False)
            image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
            found = decode_page(image, secret, detectors)
            recognized = [item for item in found if len(item[0]) == 4]
            tagged = [item for item in found if len(item[0]) == 3]
            if len(recognized) + len(tagged) > 1:
                pages.append(unidentified(number, "Página sin un único QR NAMI válido"))
                continue
            if tagged:
                _, record_id, index = tagged[0][0]
                entries = (manifests.get(record_id) or {}).get("evaluation_pages", [])
                if not 0 <= index < len(entries):
                    pages.append(unidentified(number, "Documento o versión no identificados"))
                    continue
                match = {"record_id": record_id, **entries[index]}
                key = (record_id, match["rut"], match["course_id"])
                if key in seen_evaluations:
                    pages.append(unidentified(number, "Evaluación repetida o ambigua"))
                    continue
                seen_evaluations.add(key)
                pages.append(evaluation_page(Path(root), scan_id, number, np.vstack(crops(image)), match, "qr"))
                continue
            if not recognized:
                # Sheets printed before evaluations carried a QR are identified by their title and footer name.
                if ocr is None:
                    pages.append(unidentified(number, "Página sin QR NAMI y el lector de texto (Tesseract) no está instalado"))
                    continue
                code_number, name, preview = read_evaluation(ocr, image)
                if code_number is None or len(name) < 5:
                    pages.append(unidentified(number, "Página sin QR NAMI ni título RF y nombre legibles"))
                    continue
                pages.append(None)
                read_later.append((len(pages) - 1, number, code_number, name, preview))
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
            has_color = color_present(aligned, template["color_box"]) or scan_has_color(aligned)
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
    preferred = list(dict.fromkeys(page["record_id"] for page in pages if page and page.get("record_id")))
    for position, number, code_number, name, preview in read_later:
        match, reason = find_person(code_number, name, manifests, preferred)
        key = match and (match["record_id"], match["rut"], match["course_id"])
        if match is None:
            pages[position] = unidentified(number, reason)
        elif key in seen_evaluations:
            pages[position] = unidentified(number, "Evaluación repetida o ambigua")
        else:
            seen_evaluations.add(key)
            pages[position] = evaluation_page(Path(root), scan_id, number, preview, match, "texto")
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
