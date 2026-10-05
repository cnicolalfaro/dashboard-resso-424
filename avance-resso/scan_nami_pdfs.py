"""Lee el curso de cada certificado NAMI (carpeta sincronizada con OneDrive) y lo guarda en un índice.

Uso:
    python avance-resso/scan_nami_pdfs.py "D:\\OneDrive - Empresas SK\\...\\Difusiones y capacitaciones"

Los PDF se llaman <RUT>_RF_<n>.pdf: el número no indica el curso, pero el texto sí
("...evaluación correspondiente a <curso> cumpliendo..."). El índice se guarda en
fuentes/nami_pdf_index.json (privado) y solo se relee lo que cambió de tamaño o fecha.
Requiere pdftotext (Git for Windows lo trae en /mingw64/bin).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

INDEX_DEFAULT = Path(__file__).resolve().parents[1] / "fuentes" / "nami_pdf_index.json"
COURSE = re.compile(r"correspondiente a\s+(.+?)\s+cumpliendo", re.IGNORECASE | re.DOTALL)
FOLIO = re.compile(r"FOLIO DEL DIPLOMA\s+(\S+)")
RUT = re.compile(r"RUT:\s*([0-9.]+-[0-9Kk])")
FECHA = re.compile(r"FECHA DE APROBACI.N\s+(.+?)\n")
PREFIXES = ("Difusión, entrega y evaluación de entendimiento sobre ", "Difusión, entrega y evaluación de entendimiento de las ",
            "Difusión, entrega y evaluación de entendimiento del ", "Difusión, entrega y evaluación de entendimiento ",
            "Difusión, entrega y evaluación de ", "Difusión, entrega y evaluación ")


def long_path(path: Path) -> str:
    # Las rutas de IRL superan 260 caracteres: el prefijo \\?\ las habilita en Windows.
    text = str(path.resolve())
    return text if text.startswith("\\\\?\\") or os.name != "nt" else "\\\\?\\" + text


def find_pdftotext() -> str:
    found = shutil.which("pdftotext")
    if found:
        return found
    for candidate in (r"C:\Program Files\Git\mingw64\bin\pdftotext.exe", r"C:\Program Files (x86)\Git\mingw64\bin\pdftotext.exe"):
        if Path(candidate).exists():
            return candidate
    raise SystemExit("No se encontró pdftotext.")


def read_pdf(pdftotext: str, source: Path, tmp_dir: str) -> dict[str, str]:
    fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=tmp_dir)
    os.close(fd)
    try:
        shutil.copyfile(long_path(source), tmp)
        text = subprocess.run([pdftotext, "-l", "1", "-enc", "UTF-8", tmp, "-"], capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
    except Exception as error:  # archivo bloqueado, sin conexión, PDF dañado
        return {"error": str(error)[:200]}
    finally:
        os.remove(tmp)
    match = COURSE.search(text)
    if not match:
        return {"error": "sin texto de curso"}
    course = " ".join(match.group(1).split())
    for prefix in PREFIXES:
        if course.startswith(prefix):
            course = course[len(prefix):]
            break
    folio = FOLIO.search(text)
    fecha = FECHA.search(text)
    rut = RUT.search(text)
    return {
        "course": course,
        "folio": folio.group(1) if folio else "",
        "fecha": fecha.group(1).strip() if fecha else "",
        "rut": re.sub(r"[^0-9K]", "", rut.group(1).upper()) if rut else "",
        "aprobado": "CERTIFICADO DE" in text and "APROBACI" in text,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Indexa el curso de cada certificado NAMI.")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--index", type=Path, default=INDEX_DEFAULT)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    index = json.loads(args.index.read_text(encoding="utf-8")) if args.index.exists() else {}
    pdftotext = find_pdftotext()
    root = long_path(args.folder)

    pending = []
    seen = set()
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if not name.lower().endswith(".pdf"):
                continue
            full = Path(dirpath) / name
            rel = os.path.relpath(os.path.join(dirpath, name), root).replace("\\", "/")
            stat = full.stat()
            stamp = f"{stat.st_size}:{int(stat.st_mtime)}"
            seen.add(rel)
            cached = index.get(rel)
            if cached and cached.get("stamp") == stamp and "course" in cached and "rut" in cached:
                continue
            pending.append((rel, full, stamp))

    for rel in set(index) - seen:
        del index[rel]
    print(f"PDF en la carpeta: {len(seen)} · por leer: {len(pending)}", flush=True)

    with tempfile.TemporaryDirectory() as tmp_dir, ThreadPoolExecutor(args.workers) as pool:
        futures = [(rel, stamp, pool.submit(read_pdf, pdftotext, full, tmp_dir)) for rel, full, stamp in pending]
        for done, (rel, stamp, future) in enumerate(futures, 1):
            index[rel] = {"stamp": stamp, **future.result()}
            if done % 200 == 0 or done == len(futures):
                print(f"  {done}/{len(futures)}", flush=True)
                args.index.parent.mkdir(parents=True, exist_ok=True)
                args.index.write_text(json.dumps(index, ensure_ascii=False, indent=0), encoding="utf-8")

    args.index.parent.mkdir(parents=True, exist_ok=True)
    args.index.write_text(json.dumps(index, ensure_ascii=False, indent=0), encoding="utf-8")
    errors = [rel for rel, value in index.items() if "error" in value]
    courses = {}
    for value in index.values():
        if "course" in value:
            courses[value["course"]] = courses.get(value["course"], 0) + 1
    print(f"Índice: {args.index} · cursos distintos: {len(courses)} · con error: {len(errors)}")
    for course, count in sorted(courses.items(), key=lambda item: -item[1]):
        print(f"  {count:5d}  {course}")
    for rel in errors[:20]:
        print("  ERROR", rel, index[rel]["error"])


if __name__ == "__main__":
    main()
