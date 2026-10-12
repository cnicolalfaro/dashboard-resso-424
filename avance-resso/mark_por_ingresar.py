"""Marca como "por ingresar" a quienes la tarja trae con fecha de contrato futura.

Se ven en la matriz pero no cuentan en dotación ni porcentajes. La página (app.js) los activa
sola cuando llega su fecha de contrato ("ingreso"), así no hay que volver a cifrar ni publicar.
Correr después de sync_tarja.py:

    python avance-resso/mark_por_ingresar.py "TARJA OCTUBRE OBRA 424..xlsb"
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from pyxlsb import open_workbook

from recalc import recalc


def normalize_rut(value: object) -> str:
    return re.sub(r"[^0-9K]", "", str(value or "").upper()).lstrip("0")


def to_date(value: object) -> date | None:
    if isinstance(value, (int, float)) and value > 0:
        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date()
    if isinstance(value, datetime):
        return value.date()
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tarja", type=Path)
    parser.add_argument("--snapshot", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "avance_resso_data.js")
    parser.add_argument("--hoy", help="Fecha de referencia AAAA-MM-DD (por defecto, hoy)")
    args = parser.parse_args()
    today = date.fromisoformat(args.hoy) if args.hoy else date.today()

    with open_workbook(str(args.tarja)) as wb, wb.get_sheet("TARJA") as sheet:
        rows = [[c.v for c in r] for r in sheet.rows()]
    header = [str(h or "").strip().upper() for h in rows[2]]
    rut_col, cont_col = header.index("RUT"), header.index("F CONT")
    contrato = {normalize_rut(r[rut_col]): to_date(r[cont_col]) for r in rows[3:]
                if len(r) > cont_col and len(normalize_rut(r[rut_col])) >= 7}

    text = args.snapshot.read_text(encoding="utf-8")
    data = json.loads(text.split("=", 1)[1].strip().removesuffix(";"))
    marked, activated = [], 0
    for person in data["personas"]:
        f = contrato.get(normalize_rut(person["rut"]))
        if person.get("estado") == "por_ingresar" and (not f or f <= today):
            person.pop("estado"); person.pop("ingreso", None); activated += 1     # ya ingresó
        elif not person.get("estado") and f and f > today:
            person["estado"] = "por_ingresar"; person["ingreso"] = f.isoformat()
            marked.append((person["nombre"], f.isoformat()))
    recalc(data)
    args.snapshot.write_text("window.AVANCE_RESSO_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
                             encoding="utf-8")
    print(f"Por ingresar: {len(marked)} · activados (fecha cumplida): {activated}")
    for nombre, f in marked:
        print(f"  {f}  {nombre}")
    print(f"Dotación vigente: {data['total_dotacion_activa']} · avance promedio: {data['avance_promedio_pct']}%")


if __name__ == "__main__":
    main()
