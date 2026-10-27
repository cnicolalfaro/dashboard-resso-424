"""Reutiliza enlaces comunes de v10 segun la hoja de equivalencias de v11.

Uso: python scripts/trasladar_catalogo_v11.py <planilla_v11.xlsx>
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path

import openpyxl

from trasladar_avances_v11 import EQUIVALENT

CATALOG = Path(__file__).resolve().parents[1] / "assets" / "evidence-catalog.js"
PREFIX = "globalThis.RESSO_EVIDENCE_CATALOG = "


def transfer(catalog, mappings):
    result = deepcopy(catalog)
    if result["schemaVersion"] != 1:
        raise ValueError("Version de catalogo desconocida.")
    source, target = result["versions"]["v10"], result["versions"]["v11"]
    seen = set()
    added = 0
    for row in mappings:
        if len(row) < 9 or not isinstance(row[0], int) or not isinstance(row[3], (int, float)):
            continue
        id_, kind = str(row[0]), row[7]
        if id_ in seen or not 1 <= int(id_) <= 40:
            raise ValueError(f"Equivalencia duplicada o invalida: {id_}")
        seen.add(id_)
        if kind == "Nueva":
            continue
        if kind not in EQUIVALENT | {"Modificada", "Modificada / reubicada"}:
            raise ValueError(f"Tipo de cambio desconocido: {kind}")
        for source_id in (str(int(part.strip())) for part in str(row[4]).split("+")):
            if not 1 <= int(source_id) <= 40:
                raise ValueError(f"Requisito v10 invalido: {source_id}")
            for file in source.get(source_id, []):
                if file.get("localPath"):
                    raise ValueError("El catalogo comun no debe contener rutas locales.")
                files = target.setdefault(id_, [])
                if any(saved["url"] == file["url"] for saved in files):
                    continue
                label = (f"Equivalente v10 #{source_id}" if kind in EQUIVALENT
                         else f"Antecedente v10 #{source_id} - validar alcance v11")
                files.append(dict(name=f'{file["name"]} [{label}]', url=file["url"]))
                added += 1
    return result, added


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook")
    args = parser.parse_args()
    workbook = openpyxl.load_workbook(args.workbook, data_only=True)
    text = CATALOG.read_text(encoding="utf-8")
    if not text.startswith(PREFIX):
        raise ValueError("Formato de catalogo inesperado.")
    catalog = json.loads(text[len(PREFIX):].rstrip().removesuffix(";"))
    result, added = transfer(catalog, workbook["Cambios v10 → v11"].iter_rows(values_only=True))
    CATALOG.write_text(PREFIX + json.dumps(result, ensure_ascii=False, indent=2).replace("<", "\\u003c") +
                       ";\n", encoding="utf-8")
    print(f"V11: {added} enlaces agregados por equivalencia. V10 intacta.")


if __name__ == "__main__":
    main()
