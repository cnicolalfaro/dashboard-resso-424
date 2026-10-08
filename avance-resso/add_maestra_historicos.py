"""Agrega a la matriz a quienes tienen registros en la Maestra de Capacitación pero ya no están en la tarja.

Uso (antes de apply_maestra.py):
    python avance-resso/add_maestra_historicos.py "Maestra de Capacitación 01-10-26.xlsx" "TARJA OCTUBRE OBRA 424..xlsb"

Son personas que se capacitaron y se fueron antes de que existiera la matriz. Entran como no vigentes
("finiquitado" con la fecha y motivo de la hoja Finiquitados de la tarja, o "fuera_tarja" si no figuran ahí):
se ven en la matriz con sus tickets de la Maestra, pero no cuentan en dotación, aprobados ni porcentajes.
Si alguna vuelve a la tarja, sync_tarja.py la reactiva.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

import openpyxl

from recalc import mark_calculation_base, recalc
from sync_tarja import excel_date, normalize_rut, read_sheet, text

SHEET = "MAESTRA DE CAPACITACIÓN"


def plain(value: object) -> str:
    value = unicodedata.normalize("NFD", str(value or ""))
    return "".join(c for c in value if unicodedata.category(c) != "Mn").upper().strip()


def format_rut(value: object) -> str:
    rut = normalize_rut(value)
    return f"{rut[:-1]}-{rut[-1]}" if len(rut) >= 2 else rut


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("maestra", type=Path)
    parser.add_argument("tarja", type=Path)
    parser.add_argument("--snapshot", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "avance_resso_data.js")
    args = parser.parse_args()

    rows = list(openpyxl.load_workbook(args.maestra, read_only=True, data_only=True)[SHEET].iter_rows(min_row=4, values_only=True))
    header = [plain(h) for h in rows[0]]
    col = {name: header.index(name) for name in ("RUT", "NOMBRE", "A PATERNO", "A MATERNO", "ESPECIALIDAD")}
    opt = {name: header.index(name) for name in ("CATEGORIA", "TURNO") if name in header}

    finiquitos: dict[str, tuple[str, str]] = {}
    for row in read_sheet(args.tarja, "Finiquitados")[1:]:
        rut = normalize_rut(row[0])
        if rut:
            current = (excel_date(row[10]), text(row[6]))
            if current[0] >= finiquitos.get(rut, ("", ""))[0]:
                finiquitos[rut] = current

    data = json.loads(args.snapshot.read_text(encoding="utf-8").split("=", 1)[1].strip().removesuffix(";"))
    docs = data["documentos"]
    mark_calculation_base(data)
    known = {normalize_rut(p["rut"]) for p in data["personas"]}

    added = []
    for row in rows[1:]:
        if not row or len(row) <= col["RUT"]:
            continue
        rut = normalize_rut(row[col["RUT"]])
        if len(rut) < 7 or rut in known:
            continue
        known.add(rut)
        person = {
            "rut": format_rut(row[col["RUT"]]),
            "nombre": " ".join(text(row[col[k]]) for k in ("NOMBRE", "A PATERNO", "A MATERNO") if text(row[col[k]])),
            "especialidad": text(row[col["ESPECIALIDAD"]]),
            "categoria": text(row[opt["CATEGORIA"]]) if "CATEGORIA" in opt else ".",
            "turno": text(row[opt["TURNO"]]) if "TURNO" in opt else "",
            "aprob": "0" * len(docs),
            "avance_pct": 0.0,
        }
        if rut in finiquitos:
            person["estado"] = "finiquitado"
            person["baja"], person["motivo_baja"] = finiquitos[rut]
        else:
            person["estado"] = "fuera_tarja"
        data["personas"].append(person)
        added.append(person)

    recalc(data)
    args.snapshot.write_text("window.AVANCE_RESSO_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Agregadas desde la Maestra (no vigentes): {len(added)} · finiquitados: {sum(p['estado'] == 'finiquitado' for p in added)}"
          f" · fuera de tarja: {sum(p['estado'] == 'fuera_tarja' for p in added)}")
    for p in added:
        if p["estado"] == "fuera_tarja":
            print("  fuera de tarja:", p["rut"], p["nombre"], "|", p["especialidad"])
    print(f"Personas en la matriz: {len(data['personas'])} · dotación vigente (no cambia): {data['total_dotacion_activa']}")


if __name__ == "__main__":
    main()
