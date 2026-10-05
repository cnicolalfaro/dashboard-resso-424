"""Recalcula las métricas del snapshot contando solo a las personas vigentes.

Las personas con "estado" (finiquitado / fuera de tarja) siguen en la matriz con sus
evidencias, pero no entran en la dotación, en los aprobados por curso ni en el promedio.
"""
from __future__ import annotations

from typing import Any


def mark_calculation_base(data: dict[str, Any]) -> None:
    """Guarda, una sola vez, qué cursos siguen la regla aprobados = personas con '1'.

    Algún curso (ej. Mapas de proceso) trae su total desde otra base; ese se respeta tal cual.
    Se evalúa contra todas las personas antes de excluir a nadie.
    """
    people = data["personas"]
    for i, doc in enumerate(data["documentos"]):
        if "calculo" not in doc:
            count = sum(1 for p in people if p["aprob"][i] == "1")
            doc["calculo"] = "dotacion" if count == doc["aprobados"] else "fuente"


def recalc(data: dict[str, Any]) -> None:
    mark_calculation_base(data)
    docs = data["documentos"]
    active = [p for p in data["personas"] if not p.get("estado")]
    total = len(active)
    for person in data["personas"]:
        person["avance_pct"] = round(100 * person["aprob"].count("1") / len(docs), 1)
    for i, doc in enumerate(docs):
        if doc["calculo"] == "dotacion":
            doc["aprobados"] = sum(1 for p in active if p["aprob"][i] == "1")
            doc["avance_pct"] = round(100 * doc["aprobados"] / total, 1) if total else 0
    data["total_dotacion_activa"] = total
    data["total_no_vigentes"] = len(data["personas"]) - total
    data["avance_promedio_pct"] = round(sum(d["avance_pct"] for d in docs) / len(docs), 1)
