import difflib
import os
import re
import shutil
import subprocess
import unicodedata

import cv2
import numpy as np

TITLE_FRACTION = 0.22
FOOTER_FRACTION = 0.14
NAME_THRESHOLD = 0.88
AMBIGUITY_GAP = 0.04
OCR_SECONDS = 25


def normalize(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z ]", " ", text).split())


def course_number(code):
    found = re.search(r"(\d+)\s*$", str(code))
    return int(found.group(1)) if found else None


def tesseract_path():
    return os.environ.get("NAMI_TESSERACT") or shutil.which("tesseract")


def read_text(executable, image, psm):
    ok, png = cv2.imencode(".png", image)
    if not ok:
        return ""
    environment = {**os.environ, "OMP_THREAD_LIMIT": "1"}
    try:
        result = subprocess.run([executable, "stdin", "stdout", "-l", "spa", "--psm", str(psm)],
                                input=png.tobytes(), capture_output=True, timeout=OCR_SECONDS, env=environment)
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.decode("utf-8", "ignore")


def crops(image):
    height = image.shape[0]
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    return gray[:round(height * TITLE_FRACTION)], gray[height - round(height * FOOTER_FRACTION):]


def read_header_footer(executable, image):
    """Course number from the 'RF-NN' title and the worker name stamped in the footer."""
    title, footer = crops(image)
    number = None
    found = re.search(r"R[FE]\s*[-–—_.]?\s*0?(\d{1,2})\b", read_text(executable, title, 6))
    if found:
        number = int(found.group(1))
    text = " ".join(read_text(executable, footer, 6).split())
    name = normalize(re.split(r"capataz", text, flags=re.IGNORECASE)[0])
    return number, name, np.vstack([title, footer])


def read_evaluation(executable, image):
    # A sheet scanned upside down is read again turned around before giving up.
    number, name, preview = read_header_footer(executable, image)
    if number is None or len(name) < 5:
        turned = cv2.rotate(image, cv2.ROTATE_180)
        other_number, other_name, other_preview = read_header_footer(executable, turned)
        if other_number is not None and len(other_name) >= 5:
            return other_number, other_name, other_preview
    return number, name, preview


def find_person(number, name, manifests, preferred):
    """Return (match, reason). The sheet must match a person still pending that course."""
    for pool in (preferred, [key for key in manifests if key not in preferred]):
        hits = []
        for record_id in pool:
            manifest = manifests[record_id]
            course = next((c for c in manifest.get("courses", []) if course_number(c["code"]) == number), None)
            if course is None:
                continue
            for person in manifest.get("participants", []):
                if course["id"] not in person.get("pending", [course["id"]]):
                    continue
                score = difflib.SequenceMatcher(None, name, normalize(person["nombre"])).ratio()
                if score >= NAME_THRESHOLD:
                    hits.append((score, record_id, person, course))
        if not hits:
            continue
        hits.sort(key=lambda item: -item[0])
        if len(hits) > 1 and hits[0][0] - hits[1][0] < AMBIGUITY_GAP and (
                hits[0][1], hits[0][2]["rut"]) != (hits[1][1], hits[1][2]["rut"]):
            return None, "Evaluación asociada a más de una persona o registro; revísala manualmente"
        score, record_id, person, course = hits[0]
        return {"record_id": record_id, "rut": person["rut"], "nombre": person["nombre"],
                "code": course["code"], "course_id": course["id"], "score": round(score, 2)}, None
    return None, "El nombre y el RF de la hoja no coinciden con ningún registro generado"
