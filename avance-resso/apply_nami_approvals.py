"""Marca como aprobados los cursos que tienen certificado NAMI y aún figuran pendientes.

Uso (después de import_nami_links.py):
    python avance-resso/apply_nami_approvals.py

Solo suma: nunca quita una aprobación que venga de Forms, la plataforma o la maestra.
Recalcula con las mismas reglas del snapshot (ver recalc.py): % persona = aprobados / cursos;
aprobados y % por curso solo con personas vigentes; promedio = media de los % por curso.
Las celdas agregadas quedan registradas en namiLinks.added para mostrarlas como "por certificado NAMI".
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from recalc import mark_calculation_base, recalc

SOURCE_LABEL = "Certificado NAMI"


def normalize_rut(value: object) -> str:
    return re.sub(r"[^0-9K]", "", str(value or "").upper())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--snapshot", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "avance_resso_data.js")
    args = parser.parse_args()

    text = args.snapshot.read_text(encoding="utf-8")
    data = json.loads(text.split("=", 1)[1].strip().removesuffix(";"))
    nami = data.get("namiLinks") or {}
    if nami.get("docOrder") != [d["titulo"] for d in data["documentos"]]:
        raise SystemExit("Los enlaces NAMI no corresponden a este snapshot: vuelve a correr import_nami_links.py.")

    docs = data["documentos"]
    mark_calculation_base(data)
    total_docs = len(docs)
    added_by_doc = [0] * total_docs
    added = nami.get("added", {})
    for person in data["personas"]:
        rut = normalize_rut(person["rut"])
        links = nami.get("people", {}).get(rut)
        if not links or not links.get("docs"):
            continue
        aprob = list(person["aprob"])
        new = [int(i) for i in links["docs"] if aprob[int(i)] != "1"]
        if not new:
            continue
        for i in new:
            aprob[i] = "1"
            added_by_doc[i] += 1
        person["aprob"] = "".join(aprob)
        previous = [int(x) for x in added.get(rut, "").split(",") if x]
        added[rut] = ",".join(str(i) for i in sorted(set(previous + new)))

    for doc, count in zip(docs, added_by_doc):
        if count and SOURCE_LABEL not in doc.get("fuentes", []):
            doc.setdefault("fuentes", []).append(SOURCE_LABEL)
    # Aprobados y % por curso se recalculan solo con personas vigentes (finiquitados no cuentan).
    recalc(data)
    nami["added"] = added

    args.snapshot.write_text("window.AVANCE_RESSO_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

    print(f"Aprobaciones agregadas por certificado NAMI: {sum(added_by_doc)} en {sum(1 for c in added_by_doc if c)} cursos")
    for doc, count in sorted(zip(docs, added_by_doc), key=lambda item: -item[1]):
        if count:
            print(f"  +{count:4d}  {doc['avance_pct']:5.1f}%  {doc['titulo'][:80]}")
    print(f"Avance promedio: {data['avance_promedio_pct']}%")


if __name__ == "__main__":
    main()
