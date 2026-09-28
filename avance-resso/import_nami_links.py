from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import openpyxl


ROOT_FOLDER = "NAMI SK DIGITAL"
CATEGORY_KEYS = {
    "EVALUACIONES_DE_ENTENDIMIENTO_SEGUIRDAD_SALUD_OCUPACIONAL_Y_MEDIO_AMBIENTE": "IRL",
    "Medio_Ambiente": "MA",
    "Riesgos_de_Fatalidad": "RF",
    "Reglamentos_Internos_Mineros_CODELCO": "RIM",
}
RUT_SUFFIX = re.compile(r"_(\d{7,8}[0-9K])$", re.IGNORECASE)


def normalize_rut(value: object) -> str:
    return re.sub(r"[^0-9K]", "", str(value or "").upper())


def rut_from_folder(folder_name: str) -> str:
    match = RUT_SUFFIX.search(folder_name)
    return normalize_rut(match.group(1)) if match else ""


def load_snapshot(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    prefix, payload = text.split("=", 1)
    if "AVANCE_RESSO_DATA" not in prefix:
        raise ValueError(f"Formato no reconocido: {path}")
    return json.loads(payload.strip().removesuffix(";"))


def workbook_links(path: Path) -> tuple[dict[str, dict[str, Any]], str]:
    sheet = openpyxl.load_workbook(path, read_only=False, data_only=False).active
    workers: dict[str, dict[str, Any]] = {}
    modified_values: list[datetime] = []

    for row_number in range(2, sheet.max_row + 1):
        name_cell = sheet.cell(row_number, 1)
        name = str(name_cell.value or "").strip()
        parent_path = str(sheet.cell(row_number, 6).value or "").strip()
        parent_folder = parent_path.rsplit("/", 1)[-1]
        link = name_cell.hyperlink.target if name_cell.hyperlink else ""
        modified = sheet.cell(row_number, 2).value
        if isinstance(modified, datetime):
            modified_values.append(modified)

        if parent_folder == ROOT_FOLDER:
            rut = rut_from_folder(name)
            if rut:
                workers.setdefault(rut, {"root": "", "categories": {}})["root"] = link
            continue

        category = CATEGORY_KEYS.get(name)
        rut = rut_from_folder(parent_folder)
        if category and rut:
            workers.setdefault(rut, {"root": "", "categories": {}})["categories"][category] = link

    updated_at = max(modified_values).strftime("%Y-%m-%d %H:%M") if modified_values else ""
    return workers, updated_at


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa enlaces NAMI al snapshot privado de Avance RESSO.")
    parser.add_argument("workbook", type=Path, help="Excel exportado desde la biblioteca SharePoint")
    parser.add_argument(
        "--snapshot",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "avance_resso_data.js",
    )
    args = parser.parse_args()

    snapshot = load_snapshot(args.snapshot)
    links, updated_at = workbook_links(args.workbook)
    active_ruts = {normalize_rut(person.get("rut")) for person in snapshot.get("personas", [])}
    active_links = {rut: value for rut, value in links.items() if rut in active_ruts}

    snapshot["namiLinks"] = {
        "updatedAt": updated_at,
        "people": active_links,
    }
    output = "window.AVANCE_RESSO_DATA = " + json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + ";\n"
    args.snapshot.write_text(output, encoding="utf-8")

    category_count = sum(len(value["categories"]) for value in active_links.values())
    print(f"Trabajadores activos con carpeta NAMI: {len(active_links)}")
    print(f"Enlaces de categoría incorporados: {category_count}")
    print(f"Actualización de la query: {updated_at or 'sin fecha'}")


if __name__ == "__main__":
    main()