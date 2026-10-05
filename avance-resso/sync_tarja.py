"""Sincroniza la matriz con la tarja del mes.

Uso:
    python avance-resso/sync_tarja.py "TARJA OCTUBRE OBRA 424..xlsb"

- Agrega a las personas de la hoja TARJA que figuran "Activo" en la hoja Maestra y aún
  no están en el snapshot (entran con todos los cursos pendientes).
- No borra a nadie: quien ya no está en la TARJA queda marcado como finiquitado (con fecha
  y motivo de la hoja Finiquitados) o "fuera de tarja". Sigue visible en la matriz con sus
  evidencias, pero no cuenta en dotación, aprobados ni porcentajes.
- Si alguien marcado vuelve a la tarja (recontratado), se reactiva.
Después correr import_nami_links.py y apply_nami_approvals.py.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import date, timedelta
from pathlib import Path

from pyxlsb import open_workbook

from recalc import mark_calculation_base, recalc


def normalize_rut(value: object) -> str:
    return re.sub(r"[^0-9K]", "", str(value or "").upper())


def text(value: object) -> str:
    return str(value).strip() if value not in (None, "") else ""


def excel_date(value: object) -> str:
    try:
        return (date(1899, 12, 30) + timedelta(days=int(float(value)))).isoformat()
    except (TypeError, ValueError):
        return ""


def read_sheet(path: Path, name: str) -> list[list[object]]:
    with open_workbook(str(path)) as workbook, workbook.get_sheet(name) as sheet:
        return [[cell.v for cell in row] for row in sheet.rows()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tarja", type=Path)
    parser.add_argument("--snapshot", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "avance_resso_data.js")
    args = parser.parse_args()

    tarja = read_sheet(args.tarja, "TARJA")
    header = [text(h).upper() for h in tarja[2]]
    col = {name: header.index(name) for name in ("RUT", "NOMBRE", "A PATERNO", "A MATERNO", "ESPECIALIDAD", "CATEGORIA", "TURNO")}
    in_tarja = {normalize_rut(row[col["RUT"]]): row for row in tarja[3:] if len(normalize_rut(row[col["RUT"]])) >= 7}
    active = {normalize_rut(row[0]) for row in read_sheet(args.tarja, "Maestra")[1:] if text(row[5]).lower() == "activo"}
    # Finiquitados: columnas RUT, ..., Motivo (6), ..., Fe_Fin (10). Si hay varias bajas, la más reciente.
    finiquitos: dict[str, tuple[str, str]] = {}
    for row in read_sheet(args.tarja, "Finiquitados")[1:]:
        rut = normalize_rut(row[0])
        if rut:
            current = (excel_date(row[10]), text(row[6]))
            if current[0] >= finiquitos.get(rut, ("", ""))[0]:
                finiquitos[rut] = current

    raw = args.snapshot.read_text(encoding="utf-8")
    data = json.loads(raw.split("=", 1)[1].strip().removesuffix(";"))
    docs = data["documentos"]
    mark_calculation_base(data)  # antes de excluir a nadie

    known = {normalize_rut(p["rut"]) for p in data["personas"]}
    added = []
    for rut, row in in_tarja.items():
        if rut in known or rut not in active:
            continue
        person = {
            "rut": text(row[col["RUT"]]),
            "nombre": " ".join(text(row[col[k]]) for k in ("NOMBRE", "A PATERNO", "A MATERNO") if text(row[col[k]])),
            "especialidad": text(row[col["ESPECIALIDAD"]]),
            "categoria": text(row[col["CATEGORIA"]]) or ".",
            "turno": text(row[col["TURNO"]]),
            "aprob": "0" * len(docs),
            "avance_pct": 0.0,
        }
        data["personas"].append(person)
        added.append(person)

    marked, reactivated = [], []
    for person in data["personas"]:
        rut = normalize_rut(person["rut"])
        if rut in in_tarja:
            if person.pop("estado", None):
                person.pop("baja", None)
                person.pop("motivo_baja", None)
                reactivated.append(person)
            continue
        if rut in finiquitos:
            person["estado"] = "finiquitado"
            person["baja"], person["motivo_baja"] = finiquitos[rut]
        else:
            person["estado"] = "fuera_tarja"
            person.pop("baja", None)
            person.pop("motivo_baja", None)
        marked.append(person)

    recalc(data)
    data["dotacion_fuente"] = args.tarja.name
    args.snapshot.write_text("window.AVANCE_RESSO_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

    print(f"Agregadas desde la tarja: {len(added)} · reactivadas: {len(reactivated)}")
    print(f"No vigentes (visibles, no cuentan): {len(marked)} "
          f"({sum(p['estado'] == 'finiquitado' for p in marked)} finiquitados, {sum(p['estado'] == 'fuera_tarja' for p in marked)} fuera de tarja)")
    print(f"Dotación vigente: {data['total_dotacion_activa']} · avance promedio: {data['avance_promedio_pct']}%")


if __name__ == "__main__":
    main()
