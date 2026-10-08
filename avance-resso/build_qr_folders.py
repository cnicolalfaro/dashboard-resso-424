"""Arma la carpeta CERTIFICADOS QR (estructura tipo NAMI) desde el zip de certificados de Forms.

Uso:
    python avance-resso/build_qr_folders.py "<Evidencia de QR>\\evidencia forms.zip" "C:\\Users\\cnico\\CERTIFICADOS_QR_LOCAL\\CERTIFICADOS QR" [--ocr qr_ocr.json]

El zip trae un zip por curso (Certificados_RF_01_...zip) con PDF <RUT>_RF_01.pdf generados desde
Microsoft Forms. Cada PDF queda en <NOMBRE_RUT>/Riesgos_de_Fatalidad/<RUT>_RF-01.pdf, con el mismo
nombre de carpeta que el trabajador tiene en CERTIFICADOS NAMI (si tiene). Es una copia local:
se revisa y después se sube a SharePoint (Difusiones y capacitaciones/CERTIFICADOS QR).

- RUT mal digitado en Forms (dígito verificador inválido) cuyo nombre coincide con un trabajador de
  la matriz: se guarda con el RUT correcto y queda anotado en el informe.
- RUT válido que no está en la matriz: se guarda igual (carpeta con el nombre de Forms).
- Respuestas de prueba (DOC000xxx, 1234567, nombre "PRUEBA"): no se copian.
- Con --ocr (texto leído de cada certificado) se verifica que el RUT y el curso impresos
  coincidan con el nombre del archivo.
El informe queda en fuentes/qr_build_report.csv (privado).
"""
from __future__ import annotations

import argparse
import csv
import difflib
import glob
import io
import json
import os
import re
import unicodedata
import zipfile
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
FAMILY = "Riesgos_de_Fatalidad"
INNER = re.compile(r"Certificados_RF_(\d+)_", re.IGNORECASE)
FILE = re.compile(r"^([0-9]+K?|DOC\d+)_RF_(\d+)(?:_(\d+))?\.pdf$", re.IGNORECASE)


def normalize_rut(value: object) -> str:
    return re.sub(r"[^0-9K]", "", str(value or "").upper()).lstrip("0")  # 08003871-2 = 8003871-2


def plain(text: str) -> str:
    text = unicodedata.normalize("NFD", str(text or ""))
    return " ".join("".join(c for c in text if unicodedata.category(c) != "Mn").upper().split())


def rut_ok(rut: str) -> bool:
    body, dv = rut[:-1], rut[-1:]
    if not body.isdigit() or len(rut) < 8:
        return False
    total, factor = 0, 2
    for digit in reversed(body):
        total += int(digit) * factor
        factor = 2 if factor == 7 else factor + 1
    rest = 11 - total % 11
    return dv == ("0" if rest == 11 else "K" if rest == 10 else str(rest))


def load_snapshot(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8").split("=", 1)[1].strip().removesuffix(";"))


def forms_names(folder: Path) -> dict[str, str]:
    """RUT -> nombre escrito en los Excel de Forms de la carpeta del zip."""
    names: dict[str, str] = {}
    for path in glob.glob(str(folder / "*.xlsx")):
        sheet = openpyxl.load_workbook(path, data_only=True).active
        rows = [r for r in sheet.iter_rows(values_only=True) if any(c not in (None, "") for c in r)]
        if not rows:
            continue
        header = [str(c or "").strip().lower() for c in rows[0]]
        i_rut = next((i for i, h in enumerate(header) if h.startswith("rut del trabajador")), None)
        i_name = next((i for i, h in enumerate(header) if h.startswith("nombre del trabajador")), None)
        if i_rut is None or i_name is None:
            continue
        for row in rows[1:]:
            if normalize_rut(row[i_rut]) and row[i_name]:
                names.setdefault(normalize_rut(row[i_rut]), plain(row[i_name]))
    return names


def ocr_check(lines: list[str], rut: str, code: str) -> list[str]:
    text = " ".join(lines).upper()
    problems = []
    printed = re.search(r"RUT[:;]?\s*([0-9.,\s]+-?\s*[0-9K])", text)
    if not printed:
        problems.append("OCR: no se leyó el RUT")
    elif normalize_rut(printed.group(1)) != rut:
        problems.append(f"OCR: RUT impreso {normalize_rut(printed.group(1))}")
    if not re.search(rf"RF-?{int(code):02d}(?!\d)", text.replace(" ", "")):
        problems.append("OCR: curso impreso distinto")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("zip", type=Path)
    parser.add_argument("out", type=Path, help="Carpeta local CERTIFICADOS QR (fuera de OneDrive)")
    parser.add_argument("--snapshot", type=Path, default=ROOT / "data" / "avance_resso_data.js")
    parser.add_argument("--ocr", type=Path, help="JSON {ruta_relativa: [líneas OCR]} para verificar el contenido")
    parser.add_argument("--report", type=Path, default=ROOT / "fuentes" / "qr_build_report.csv")
    args = parser.parse_args()

    data = load_snapshot(args.snapshot)
    people = {normalize_rut(p["rut"]): p for p in data["personas"]}
    nami_folders = {rut: v["folder"] for rut, v in (data.get("namiLinks") or {}).get("people", {}).items()}
    by_name = {plain(p["nombre"]): rut for rut, p in people.items()}
    names = forms_names(args.zip.parent)
    ocr_by_file = {}
    for key, lines in (json.loads(args.ocr.read_text(encoding="utf-8")) if args.ocr else {}).items():
        parts = key.replace("\\", "/").split("/")
        ocr_by_file[(parts[0], parts[-1])] = lines

    def resolve(rut: str) -> tuple[str, str]:
        if rut in people:
            return rut, ""
        name = names.get(rut, "")
        if not rut_ok(rut) and name:
            # El nombre de Forms suele venir abreviado: debe estar contenido (palabra a palabra) en el de la matriz.
            words = set(name.split())
            hits = [r for n, r in by_name.items() if words <= set(n.split())]
            if len(hits) == 1:
                return hits[0], f"RUT mal digitado en Forms ({rut})"
            close = difflib.get_close_matches(name, by_name, 1, 0.85)
            if close:
                return by_name[close[0]], f"RUT mal digitado en Forms ({rut})"
        return rut, "no está en la matriz" if rut_ok(rut) else "RUT inválido sin coincidencia"

    def folder_for(rut: str) -> str:
        if rut in nami_folders:
            return nami_folders[rut]
        name = people[rut]["nombre"] if rut in people else names.get(rut, "SIN_NOMBRE")
        return "_".join(plain(name).replace("Ñ", "N").split()) + "_" + rut

    report = []
    written = 0
    outer = zipfile.ZipFile(args.zip)
    for member in sorted(outer.namelist()):
        match = INNER.search(member.split("/")[-1])
        if not match:
            continue
        code = f"{int(match.group(1)):02d}"
        inner_name = member.split("/")[-1][:-4]
        inner = zipfile.ZipFile(io.BytesIO(outer.read(member)))
        for entry in sorted(inner.namelist()):
            file_name = entry.split("/")[-1]
            parsed = FILE.match(file_name)
            if not parsed:
                report.append([file_name, f"RF-{code}", "", "", "", "omitido: nombre no reconocido"])
                continue
            raw_rut, suffix = parsed.group(1).upper(), parsed.group(3)
            lines = ocr_by_file.get((inner_name, file_name))
            is_test = raw_rut.startswith("DOC") or raw_rut == "1234567" or (lines and any("PRUEBA" == l.strip().upper() for l in lines))
            if is_test:
                report.append([file_name, f"RF-{code}", raw_rut, "", "", "omitido: respuesta de prueba"])
                continue
            rut, note = resolve(raw_rut)
            notes = [note] if note else []
            if lines is not None:
                notes += ocr_check(lines, raw_rut, code)
            elif args.ocr:
                notes.append("OCR: sin lectura")
            target_name = f"{rut}_RF-{code}" + (f"_{suffix}" if suffix else "") + ".pdf"
            rel = f"{folder_for(rut)}/{FAMILY}/{target_name}"
            target = args.out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(inner.read(entry))
            written += 1
            report.append([file_name, f"RF-{code}", raw_rut, rut, rel, " · ".join(notes)])

    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, delimiter=";")
        writer.writerow(["archivo_zip", "curso", "rut_en_archivo", "rut_asignado", "destino", "observacion"])
        writer.writerows(report)

    folders = {r[4].split("/")[0] for r in report if r[4]}
    print(f"PDF copiados: {written} · carpetas de trabajador: {len(folders)} · omitidos: {sum(1 for r in report if not r[4])}")
    for row in report:
        if row[5]:
            print("  ·", row[0], "→", row[4] or "-", "—", row[5])
    print(f"Informe: {args.report}")


if __name__ == "__main__":
    main()
