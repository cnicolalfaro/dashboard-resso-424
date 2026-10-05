"""Marca como aprobados los cursos registrados en la Maestra de Capacitación que aún figuran pendientes.

Uso:
    python avance-resso/apply_maestra.py "Maestra de Capacitación 01-10-26.xlsx"

Regla (la misma del generador original, verificada contra el snapshot del 28-09): un curso
cuenta si la columna de CAPACITACIÓN de ese curso tiene fecha. Solo suma: nunca quita
aprobaciones de otras fuentes. Cada celda agregada queda en `maestraAdded` con su fecha, y
`maestraSeen` marca TODOS los cursos con registro en la Maestra (aunque ya estuvieran aprobados
por otra fuente), para mostrar en la matriz que esa evidencia existe.
Matriz IPER queda fuera: el generador original no usaba la Maestra para ese curso.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

import openpyxl

from recalc import mark_calculation_base, recalc

SHEET = "MAESTRA DE CAPACITACIÓN"
SOURCE_LABEL = "Maestra de Capacitación"
# (patrón en el título del curso, patrón en la cabecera de la Maestra). Las columnas RF se
# resuelven aparte ("CAPACITACIÓN RF N°<n>").
RULES = [
    (r"ACTUALIZACION IRL", r"^ACTUALIZACION IRL POR ESPECIALIDAD"),
    (r"D\.?\s?S\.?\s*N\S*\s*44", r"^INFORMACION RIESGOS LABORALES"),
    (r"IRL POR ESPECIALIDAD \(VERSION", r"^IRL POR ESPECIALIDAD \(ANTIGUA"),
    (r"DIFUSION TEMAS IRL", r"^DIFUSION TEMAS IRL"),
    (r"TOMA DE CONOCIMIENTO BEL", r"^TOMA DE CONOCIMIENTO BEL"),
    (r"PARTICIPACION DE TRABAJADORES", r"^PROCEDIMIENTOS PARA ASEGURAR"),
    (r"HERRAMIENTAS MANUALES", r"^CAPACITACION HERRAMIENTAS MANUALES"),
    (r"OBLIGACIONES, PROHIBICIONES", r"^CAPACITACION PLAN DE OBLIGACIONES, PROHIBICIONES Y FALTAS SK"),
    (r"ELEMENTOS DE PROTECCION PERSONAL", r"^CAPACITACION USO CORRECTO"),
    (r"HERRAMIENTAS DE GESTION PREVENTIVAS", r"^CAPACITACION DE HERRAMIENTAS DE GESTION PREVENTIVA"),
    (r"R-008", r"^CAPACITACION R-008"),
    (r"PLAN LOCAL DE EMERGENCIAS DCH", r"^CAPACITACION DE PLAN DE EMERGENCIA GERENCIAL"),
    (r"PLAN DE EMERGENCIAS SK", r"^CAPACITACION PLAN LOCAL DE EMERGENCIAS SK"),
    (r"AUTORRESCATADOR", r"^CAPACITACION DE USO DE EQUIPO AUTORRESCATADOR"),
    (r"POLITICA CORPORATIVA", r"^CAPACITACION POLITICA CORPORATIVA"),
    (r"PROTECCION AUDITIVA", r"^CAPACITACION SOBRE PROTECCION AUDITIVA"),
    (r"PROTECCION RESPIRATORIA", r"^CAPACITACION SOBRE PROTECCION RESPIRATORIA"),
    (r"SILICOSIS", r"^CAPACITACION SOBRE PREVENCION DE LA SILICOSIS"),
    (r"MANUAL DE CARGA", r"^CAPACITACION SOBRE EL MANEJO MANUAL"),
    (r"PSICOSOCIALES", r"^CAPACITACION EXPOSICION A FACTORES"),
    (r"RADIACION UV", r"^CAPACITACION EXPOSICION A RADIACION"),
    (r"TMERT", r"^CAPACITACION DE TRASTORNOS"),
    (r"ALTAS TEMPERATURAS", r"^CAPACITACION EXPOSICION A ALTAS"),
    (r"HIPOACUSIA", r"^CAPACITACION SOBRE PREVENCION DE LA HIPOACUSIA"),
    (r"METALES Y METALOIDES", r"^CAPACITACION EXPOSICION OCUPACONAL"),
    (r"ESTANDARES DE SALUD", r"^CAPACITACION DE APRENDIZAJE SOBRE ESTANDARES"),
    (r"ACTA IRL MEDIO AMBIENTE", r"^ACTA IRL MEDIO"),
    (r"INDUCCION AMBIENTAL", r"^CAPACITACION CHARLA DE INDUCCION AMBIENTAL"),
    (r"SUSTANCIAS PELIGROSAS DS", r"^CAPACITACION DE SUSTANCIAS PELIGROSAS"),
    (r"SEGREGACION", r"^CAPACITACION SEGREGACION"),
    (r"ASPECTOS E IMPACTOS", r"^MATRIZ DE IDENTIFICACION DE"),
    (r"PROC-GMA-001", r"^CAPACITACION DE PROC-GMA-001"),
    (r"PRO-022", r"^PROCEDIMIENTO PRO-022"),
    (r"SEGURIDAD CONDUCTUAL", r"^CAPACITACION PLAN SEGURIDAD CONDUCTUAL"),
    (r"PLAN DE TRANSITO", r"^CAPACITACION PLAN DE TRANSITO"),
    (r"RIESGOS DE INCENDIO", r"^CAPACITACION DIFUSION DE RIESGOS DE INCEN"),
    (r"TARJETA VERDE \(TERRENO\)", r"^CAPACITACION APLICACION TARJETA VERDE"),
    (r"OBLIGACIONES DE EMPRESAS CONTRATISTAS", r"^OBLIGACIONES DE EMPRESAS CONTRATISTAS"),
    (r"HOMBRE NUEVO", r"^INDUCCION HOMBRE NUEVO"),
    (r"POLITICA DE SEGURIDAD Y SALUD OCUPACIONAL SK", r"^POLITICA DE SEGURIDAD Y SALUD OCUPACIONAL SK"),
    (r"RIESGO CRITICO N\S*20", r"^CAPACITACION ESPECIFICA RIESGO CRITICO"),
    (r"ANEXO IRL", r"^ANEXO IRL"),
    (r"CONSENTIMIENTO DIGITAL", r"^CARTA DE CONSENTIMIENTO"),
]


def plain(text: object) -> str:
    text = unicodedata.normalize("NFD", str(text or ""))
    return "".join(c for c in text if unicodedata.category(c) != "Mn").upper()


def normalize_rut(value: object) -> str:
    return re.sub(r"[^0-9K]", "", str(value or "").upper())


def has_record(value: object) -> bool:
    return value not in (None, "", 0, "0") and str(value).strip() not in ("-", "N/A", "NA")


def column_map(docs: list[dict], header: list[str]) -> dict[int, int]:
    mapping = {}
    for i, doc in enumerate(docs):
        title = plain(doc["titulo"])
        rf = re.match(r"RF-(\d+)", title)
        if rf:
            pattern = rf"^CAPACITACION RF N\S*{int(rf.group(1))}$"
        else:
            pattern = next((col for doc_pat, col in RULES if re.search(doc_pat, title)), None)
        if pattern:
            cols = [j for j, h in enumerate(header) if re.match(pattern, h)]
            if cols:
                mapping[i] = cols[0]
    return mapping


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("maestra", type=Path)
    parser.add_argument("--snapshot", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "avance_resso_data.js")
    args = parser.parse_args()

    rows = list(openpyxl.load_workbook(args.maestra, read_only=True, data_only=True)[SHEET].iter_rows(min_row=4, values_only=True))
    header = [plain(h).strip() for h in rows[0]]
    rut_col = header.index("RUT")
    records = {normalize_rut(r[rut_col]): r for r in rows[1:] if len(normalize_rut(r[rut_col])) >= 7}

    data = json.loads(args.snapshot.read_text(encoding="utf-8").split("=", 1)[1].strip().removesuffix(";"))
    docs = data["documentos"]
    mark_calculation_base(data)
    mapping = column_map(docs, header)

    added = data.get("maestraAdded", {})
    # Presencia en la Maestra para TODOS los cursos (aprobados o no por otra fuente): 1 = hay fecha.
    seen: dict[str, str] = {}
    added_by_doc = [0] * len(docs)
    for person in data["personas"]:
        rut = normalize_rut(person["rut"])
        row = records.get(rut)
        if row is None:
            continue
        aprob = list(person["aprob"])
        cells = added.get(rut, {})
        flags = ["0"] * len(docs)
        for i, j in mapping.items():
            if has_record(row[j]):
                flags[i] = "1"
            if aprob[i] != "1" and has_record(row[j]):
                aprob[i] = "1"
                added_by_doc[i] += 1
                value = row[j]
                cells[str(i)] = value.strftime("%Y-%m-%d") if isinstance(value, datetime) else ""
        if cells:
            added[rut] = cells
        if "1" in flags:
            seen[rut] = "".join(flags)
        person["aprob"] = "".join(aprob)

    for doc, count in zip(docs, added_by_doc):
        if count and SOURCE_LABEL not in doc.get("fuentes", []):
            doc.setdefault("fuentes", []).append(SOURCE_LABEL)
    data["maestraAdded"] = added
    data["maestraSeen"] = seen
    data["maestraFuente"] = args.maestra.name
    recalc(data)
    args.snapshot.write_text("window.AVANCE_RESSO_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

    print(f"Cursos con columna en la Maestra: {len(mapping)} de {len(docs)}")
    print(f"Registros agregados desde la Maestra: {sum(added_by_doc)} en {sum(1 for c in added_by_doc if c)} cursos "
          f"· personas con algún registro nuevo: {sum(1 for v in added.values() if v)}")
    for doc, count in sorted(zip(docs, added_by_doc), key=lambda item: -item[1])[:12]:
        if count:
            print(f"  +{count:4d}  {doc['avance_pct']:5.1f}%  {doc['titulo'][:70]}")
    print(f"Celdas con registro en la Maestra (ticket de existencia): {sum(f.count('1') for f in seen.values())} en {len(seen)} personas")
    print(f"Avance promedio: {data['avance_promedio_pct']}%")


if __name__ == "__main__":
    main()
