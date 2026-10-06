"""Revisa los certificados NAMI renombrados (<RUT>_<CÓDIGO>.pdf) contra lo que dice el PDF.

Uso (después de scan_nami_pdfs.py sobre la carpeta CERTIFICADOS NAMI):
    python avance-resso/check_nami_names.py

Para cada código (RF-01, IRL-024...) toma el curso más frecuente leído dentro de los PDF y
marca los archivos cuyo curso no coincide, los de RUT distinto al de la carpeta o al impreso,
los que no son certificado de aprobación, los que están en otra familia y los nombres fuera
de formato. Deja el detalle en fuentes/nami_name_check.csv (privado).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r"^(\d{7,8}[0-9K])_((RF|R|RIM|IRL|MA)-\d+)\.pdf$", re.IGNORECASE)
RUT_SUFFIX = re.compile(r"_(\d{7,8}[0-9K])$", re.IGNORECASE)
FAMILY = {
    "RF": "Riesgos_de_Fatalidad",
    "R": "Reglamentos_Internos_Mineros_CODELCO",
    "RIM": "Reglamentos_Internos_Mineros_CODELCO",
    "IRL": "EVALUACIONES_DE_ENTENDIMIENTO_SEGUIRDAD_SALUD_OCUPACIONAL_Y_MEDIO_AMBIENTE",
    "MA": "Medio_Ambiente",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--index", type=Path, default=ROOT / "fuentes" / "nami_pdf_index.json")
    parser.add_argument("--report", type=Path, default=ROOT / "fuentes" / "nami_name_check.csv")
    args = parser.parse_args()

    index = json.loads(args.index.read_text(encoding="utf-8"))
    by_code: dict[str, Counter] = defaultdict(Counter)
    parsed = {}
    for rel, entry in index.items():
        match = NAME.match(rel.split("/")[-1])
        if match:
            code = match.group(2).upper()
            parsed[rel] = (match.group(1).upper(), code, match.group(3).upper())
            if entry.get("course"):
                by_code[code][entry["course"]] += 1
    expected = {code: courses.most_common(1)[0][0] for code, courses in by_code.items()}

    issues = []
    seen: dict[tuple[str, str], str] = {}
    for rel, entry in sorted(index.items()):
        parts = rel.split("/")
        folder_rut = (RUT_SUFFIX.search(parts[0]) or [None, ""])[1].upper()
        problems = []
        if rel not in parsed:
            issues.append([rel, "", "nombre fuera de formato RUT_CÓDIGO.pdf", entry.get("course", ""), ""])
            continue
        file_rut, code, prefix = parsed[rel]
        if "error" in entry:
            problems.append(f"no se pudo leer: {entry['error']}")
        if file_rut != folder_rut:
            problems.append(f"RUT del archivo {file_rut} ≠ carpeta {folder_rut}")
        if entry.get("rut") and entry["rut"] != folder_rut:
            problems.append(f"RUT impreso {entry['rut']} ≠ carpeta {folder_rut}")
        if entry.get("aprobado") is False:
            problems.append("no es certificado de aprobación")
        if len(parts) > 2 and parts[1] != FAMILY[prefix]:
            problems.append(f"en carpeta {parts[1]}")
        if entry.get("course") and entry["course"] != expected.get(code):
            problems.append("curso del PDF distinto al código del nombre")
        if (folder_rut, code) in seen:
            problems.append(f"duplicado de {seen[(folder_rut, code)]}")
        seen.setdefault((folder_rut, code), rel)
        if problems:
            issues.append([rel, code, " · ".join(problems), entry.get("course", ""), expected.get(code, "")])

    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, delimiter=";")
        writer.writerow(["archivo", "codigo", "problema", "curso_en_pdf", "curso_esperado_para_codigo"])
        writer.writerows(issues)

    print(f"PDF revisados: {len(index)} · con observaciones: {len(issues)}")
    for code in sorted(by_code):
        others = sum(by_code[code].values()) - by_code[code][expected[code]]
        print(f"  {code:8s} {sum(by_code[code].values()):4d}  {expected[code][:70]}" + (f"  ({others} distintos)" if others else ""))
    for row in issues:
        print("  ·", row[0], "—", row[2], f"[PDF: {row[3][:60]}]" if row[3] else "")
    print(f"Detalle: {args.report}")


if __name__ == "__main__":
    main()
