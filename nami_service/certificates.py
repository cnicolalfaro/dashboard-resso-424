import datetime
import json
import os
import re
import tempfile
import unicodedata
import zipfile
from pathlib import Path

import pymupdf as fitz

FOLDER = "Riesgos_de_Fatalidad"


def clean_rut(rut):
    return re.sub(r"[^0-9K]", "", str(rut).upper())


def folder_part(name):
    text = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", "_", text).strip("_")


def display_date(value):
    try:
        return datetime.date.fromisoformat(value).strftime("%d-%m-%Y")
    except (TypeError, ValueError):
        return "sin-fecha"


def collect(db, date=None, scan_id=None):
    """Pair every identified evaluation with the confirmed register page where that person signed."""
    manifests = {row["id"]: json.loads(row["manifest"]) for row in db.execute("SELECT id,manifest FROM records")}
    statuses = {row["row_id"]: row["status"] for row in db.execute("SELECT row_id,status FROM results")}
    scans = db.execute("SELECT id,pdf,pages,confirmed FROM scans ORDER BY rowid").fetchall()
    registers, evaluations = {}, {}
    for scan in scans:
        for page in json.loads(scan["pages"]):
            record_id = page.get("record_id")
            if not record_id:
                continue
            if page.get("kind") == "evaluation":
                if scan_id and scan["id"] != scan_id:
                    continue
                item = page["evaluation"]
                evaluations[(record_id, item["rut"], item["code"])] = (scan["pdf"], page["page"], item["nombre"])
            elif scan["confirmed"]:
                for row in page["rows"]:
                    registers[(record_id, row["rut"])] = (scan["pdf"], page["page"], statuses.get(row["id"]))
    ready, omitted = {}, []
    for (record_id, rut, code), (pdf, page_no, name) in evaluations.items():
        manifest = manifests.get(record_id, {})
        if date and manifest.get("date") != date:
            continue
        register = registers.get((record_id, rut))
        if register is None:
            omitted.append((name, code, "su registro aún no está confirmado"))
        elif register[2] != "FIRMO":
            omitted.append((name, code, "no figura como firmado en el registro"))
        else:
            # A rescanned evaluation replaces the earlier one for the same person, course and day.
            ready[(manifest.get("date"), rut, code)] = {
                "date": manifest.get("date"), "rut": rut, "name": name, "code": code,
                "evaluation": (pdf, page_no), "register": register[:2]}
    return list(ready.values()), omitted


def existing_folders(destination):
    """Worker folders already in the destination, found by the RUT at the end of their name."""
    folders = {}
    for entry in os.scandir(destination):
        match = re.search(r"_([0-9K]+)$", entry.name.upper())
        if match and entry.is_dir():
            folders.setdefault(match.group(1).lstrip("0"), entry.name)
    return folders


def deliver_certificates(root, db, destination, date=None, scan_id=None):
    """Add the missing <NOMBRE_RUT>/Riesgos_de_Fatalidad/<RUT>_RF-NN.pdf files; never replace or delete."""
    ready, omitted = collect(db, date, scan_id)
    result = {"added": 0, "existing": 0, "failed": 0, "new_folders": 0, "omitted": len(omitted)}
    folders = existing_folders(destination)
    opened = {}
    try:
        for item in sorted(ready, key=lambda entry: (entry["name"], entry["code"])):
            rut = clean_rut(item["rut"])
            name = folders.get(rut.lstrip("0")) or f'{folder_part(item["name"])}_{rut}'
            target = Path(destination) / name / FOLDER / f'{rut}_{item["code"]}.pdf'
            if target.exists():
                result["existing"] += 1
                continue
            certificate = fitz.open()
            for pdf, page_no in (item["evaluation"], item["register"]):
                if pdf not in opened:
                    opened[pdf] = fitz.open(str(Path(root) / "scans" / pdf))
                certificate.insert_pdf(opened[pdf], from_page=page_no - 1, to_page=page_no - 1)
            data = certificate.tobytes(garbage=3, deflate=True)
            certificate.close()
            try:
                if not (Path(destination) / name).exists():
                    result["new_folders"] += 1
                target.parent.mkdir(parents=True, exist_ok=True)
                with open(target, "xb") as handle:
                    handle.write(data)
                folders.setdefault(rut.lstrip("0"), name)
                result["added"] += 1
            except FileExistsError:
                result["existing"] += 1
            except OSError:
                result["failed"] += 1
    finally:
        for document in opened.values():
            document.close()
    return result


def build_certificates(root, db, date=None, scan_id=None):
    """ZIP: <fecha>/<NOMBRE_RUT>/Riesgos_de_Fatalidad/<RUT>_RF-NN.pdf with the evaluation and its register page."""
    ready, omitted = collect(db, date, scan_id)
    if not ready:
        return None, 0, omitted
    output = tempfile.TemporaryFile()
    opened = {}

    def source(pdf):
        if pdf not in opened:
            opened[pdf] = fitz.open(str(Path(root) / "scans" / pdf))
        return opened[pdf]

    try:
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in sorted(ready, key=lambda entry: (entry["date"] or "", entry["name"], entry["code"])):
                rut = clean_rut(item["rut"])
                certificate = fitz.open()
                for pdf, page_no in (item["evaluation"], item["register"]):
                    certificate.insert_pdf(source(pdf), from_page=page_no - 1, to_page=page_no - 1)
                data = certificate.tobytes(garbage=3, deflate=True)
                certificate.close()
                archive.writestr(f'{display_date(item["date"])}/{folder_part(item["name"])}_{rut}/{FOLDER}/{rut}_{item["code"]}.pdf', data)
            if omitted:
                lines = ["Evaluaciones identificadas que no se incluyeron:"] + [
                    f"- {name} · {code}: {reason}" for name, code, reason in sorted(omitted)]
                archive.writestr("NO_INCLUIDOS.txt", "\n".join(lines) + "\n")
    except BaseException:
        output.close()
        raise
    finally:
        for document in opened.values():
            document.close()
    output.seek(0)
    return output, len(ready), omitted
