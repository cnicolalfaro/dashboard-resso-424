"""Importa la estructura de NAMI SK DIGITAL (exportada desde SharePoint) al snapshot privado.

Uso:
    python avance-resso/import_nami_links.py "C:\\ruta\\export_nami.xlsx"

El Excel es el que genera SharePoint con "Exportar a Excel" (query.iqy guardado como .xlsx)
con las columnas Nombre, Modificado, Tipo de elemento y Ruta de acceso. Si la vista exportada
incluye archivos (vista plana "sin carpetas" o carpetas + archivos), cada PDF se asocia a su
curso y la matriz abre el respaldo exacto; si solo trae carpetas, abre la carpeta de la familia.

Los enlaces no se copian del Excel: se reconstruyen desde la ruta, porque los hipervínculos
exportados llevan el GUID de una vista que deja de existir y SharePoint responde
"Error de representación desconocido".
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import openpyxl


CATEGORY_KEYS = {
    "EVALUACIONES_DE_ENTENDIMIENTO_SEGUIRDAD_SALUD_OCUPACIONAL_Y_MEDIO_AMBIENTE": "IRL",
    "Medio_Ambiente": "MA",
    "Riesgos_de_Fatalidad": "RF",
    "Reglamentos_Internos_Mineros_CODELCO": "RIM",
}
# Nombre genérico de NAMI (RUT_RF_3.pdf): el número es correlativo, no el código del curso.
GENERIC_FILE = re.compile(r"^\d{7,9}K?_(RF|IRL|RIM|MA)(_\d+)?\.pdf$", re.IGNORECASE)
RUT_SUFFIX = re.compile(r"_(\d{7,8}[0-9K])$", re.IGNORECASE)
STOPWORDS = {
    "DE", "DEL", "LA", "LAS", "EL", "LOS", "Y", "EN", "A", "AL", "POR", "PARA", "CON", "SOBRE",
    "DIFUSION", "ENTREGA", "EVALUACION", "ENTENDIMIENTO", "RF", "VS", "VS0", "VS01", "VS02", "VS03",
    "VS1", "REV", "PDF", "SK", "SKIC", "CODELCO", "2026",
}


def normalize_rut(value: object) -> str:
    return re.sub(r"[^0-9K]", "", str(value or "").upper()).lstrip("0")  # 08003871-2 = 8003871-2


def rut_from_folder(folder_name: str) -> str:
    match = RUT_SUFFIX.search(folder_name)
    return normalize_rut(match.group(1)) if match else ""


def plain(text: str) -> str:
    text = unicodedata.normalize("NFD", str(text or ""))
    return "".join(c for c in text if unicodedata.category(c) != "Mn").upper()


def tokens(text: str) -> set[str]:
    words = re.split(r"[^A-Z0-9]+", plain(text))
    return {w for w in words if len(w) > 2 and w not in STOPWORDS and not w.isdigit()}


def course_keys(title: str) -> set[str]:
    """Códigos duros del título (RF-07, R-035, PRO-022...) normalizados sin guiones."""
    t = plain(title)
    # Lookarounds en vez de \b: en nombres de archivo el "_" cuenta como letra para \b.
    keys = {f"RF{int(n)}" for n in re.findall(r"(?<![A-Z0-9])RF[-_ ]?(\d{1,2})(?!\d)", t)}
    keys |= {re.sub(r"[-_ ]", "", k) for k in re.findall(r"(?<![A-Z0-9])(?:R[-_]?\d{2,3}|PRO[-_]\d{3}|PROC[-_]GMA[-_]\d{3})(?!\d)", t)}
    return keys


def load_snapshot(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    prefix, payload = text.split("=", 1)
    if "AVANCE_RESSO_DATA" not in prefix:
        raise ValueError(f"Formato no reconocido: {path}")
    return json.loads(payload.strip().removesuffix(";"))


def read_rows(path: Path) -> tuple[list[dict[str, Any]], str]:
    sheet = openpyxl.load_workbook(path, read_only=False, data_only=True).active
    header = [str(c.value or "").strip().lower() for c in sheet[1]]

    def col(*names: str) -> int:
        for name in names:
            if name in header:
                return header.index(name)
        raise ValueError(f"Falta la columna {names[0]!r} en {path.name}. Columnas: {header}")

    i_name = col("nombre", "name")
    i_type = col("tipo de elemento", "item type")
    i_path = col("ruta de acceso", "path")
    i_mod = header.index("modificado") if "modificado" in header else None

    rows, modified = [], []
    for cells in sheet.iter_rows(min_row=2):
        name = str(cells[i_name].value or "").strip()
        parent = str(cells[i_path].value or "").strip().strip("/")
        if not name or not parent:
            continue
        mod = cells[i_mod].value if i_mod is not None else None
        if isinstance(mod, datetime):
            modified.append(mod)
        kind = str(cells[i_type].value or "").strip().lower()
        rows.append({"name": name, "parent": parent, "folder": kind.startswith("carpeta") or kind == "folder"})
    updated_at = max(modified).strftime("%Y-%m-%d %H:%M") if modified else ""
    return rows, updated_at


def read_local(folder: Path, sharepoint_path: str) -> tuple[list[dict[str, Any]], str]:
    """Recorre una carpeta sincronizada con OneDrive (no descarga los archivos, solo lee nombres)."""
    sharepoint_path = sharepoint_path.strip("/")
    root = str(folder.resolve())
    if os.name == "nt" and not root.startswith("\\\\?\\"):
        root = "\\\\?\\" + root  # rutas de IRL superan 260 caracteres
    rows, newest = [], 0.0
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        parent = sharepoint_path if rel_dir == "." else f"{sharepoint_path}/{rel_dir}"
        for name in dirnames:
            rows.append({"name": name, "parent": parent, "folder": True})
        for name in filenames:
            newest = max(newest, os.stat(os.path.join(dirpath, name)).st_mtime)
            rows.append({"name": name, "parent": parent, "folder": False})
    updated_at = datetime.fromtimestamp(newest).strftime("%Y-%m-%d %H:%M") if newest else ""
    return rows, updated_at


def match_doc(file_name: str, docs: list[dict[str, Any]], candidates: list[int]) -> tuple[int | None, float]:
    keys = course_keys(file_name)
    if keys:
        hits = [i for i in candidates if keys & course_keys(docs[i]["titulo"])]
        if len(hits) == 1:
            return hits[0], 1.0
    # Título del certificado contenido literalmente en el del curso: gana el título más corto.
    needle = " ".join(re.split(r"[^A-Z0-9]+", plain(file_name))).strip()
    exact = [i for i in candidates if needle and needle in " ".join(re.split(r"[^A-Z0-9]+", plain(docs[i]["titulo"])))]
    if exact:
        return min(exact, key=lambda i: len(docs[i]["titulo"])), 1.0
    words = tokens(re.sub(r"_\d{7,9}[0-9K]?", " ", file_name))
    best, best_score = None, 0.0
    for i in candidates:
        title_words = tokens(docs[i]["titulo"])
        if not title_words or not words:
            continue
        score = len(words & title_words) / max(len(title_words), len(words))
        if score > best_score:
            best, best_score = i, score
    return (best, best_score) if best_score >= 0.5 else (None, best_score)


def categorize(title: str) -> str:
    # Misma regla que avance-resso/app.js
    t = title.upper()
    if re.search(r"RF-?\s?\d+", t):
        return "RF"
    if any(k in t for k in ["REGLAMENTO", "R-035", "R-01 ", "R-008", "CONTROL DE INGRESO", "VENTILACION", "VENTILACIÓN"]):
        return "RIM"
    if any(k in t for k in ["MEDIO AMBIENTE", "AMBIENTAL", "RESIDUOS", "SUSTANCIAS PELIGROSAS", "PROC-GMA", "PRO-022"]):
        return "MA"
    return "IRL"


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa enlaces NAMI al snapshot privado de Avance RESSO.")
    parser.add_argument("source", type=Path, help="Excel exportado desde SharePoint, o la carpeta sincronizada con OneDrive")
    parser.add_argument("--sharepoint-path", default="", help="Ruta en SharePoint de la carpeta sincronizada (sites/ICSK-HSEC/Documentos compartidos/.../Difusiones y capacitaciones)")
    parser.add_argument("--snapshot", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "avance_resso_data.js")
    parser.add_argument("--pdf-index", type=Path, default=Path(__file__).resolve().parents[1] / "fuentes" / "nami_pdf_index.json",
                        help="Índice de scan_nami_pdfs.py con el curso leído dentro de cada certificado")
    parser.add_argument("--report", type=Path, default=Path(__file__).resolve().parents[1] / "fuentes" / "nami_match_report.csv")
    args = parser.parse_args()

    snapshot = load_snapshot(args.snapshot)
    docs = snapshot["documentos"]
    if args.source.is_dir():
        if not args.sharepoint_path:
            raise SystemExit("Con una carpeta local hay que indicar --sharepoint-path.")
        rows, updated_at = read_local(args.source, args.sharepoint_path)
    else:
        rows, updated_at = read_rows(args.source)

    # Carpeta raíz = la que contiene las carpetas NOMBRE_RUT (cambió de "NAMI SK DIGITAL"
    # a "Difusiones y capacitaciones"; se detecta sola para no depender del nombre).
    parents = Counter(r["parent"] for r in rows if r["folder"] and rut_from_folder(r["name"]))
    if not parents:
        raise SystemExit("No se encontraron carpetas de trabajador (NOMBRE_RUT) en la exportación.")
    base = parents.most_common(1)[0][0]

    people: dict[str, dict[str, Any]] = {}
    files = []
    for row in rows:
        full = f"{row['parent']}/{row['name']}"
        if not full.startswith(base + "/"):
            continue
        rel = full[len(base) + 1:].split("/")
        rut = rut_from_folder(rel[0])
        if not rut:
            continue
        entry = people.setdefault(rut, {"folder": rel[0], "categories": {}, "docs": {}})
        if row["folder"]:
            if len(rel) == 2 and rel[1] in CATEGORY_KEYS:
                entry["categories"][CATEGORY_KEYS[rel[1]]] = rel[1]
        else:
            files.append((rut, rel))

    # El nombre del PDF (RUT_RF_3.pdf) no dice el curso; el índice trae el título leído del certificado.
    pdf_index = json.loads(args.pdf_index.read_text(encoding="utf-8")) if args.pdf_index.exists() else {}
    report = []
    nami_codes: dict[int, Counter] = {}
    by_category = {key: [i for i, d in enumerate(docs) if categorize(d["titulo"]) == key] for key in CATEGORY_KEYS.values()}
    for rut, rel in files:
        entry = pdf_index.get("/".join(rel), {})
        # Solo cuenta un certificado de aprobación cuyo RUT impreso sea el de la carpeta.
        valid = entry.get("aprobado", True) and entry.get("rut", rut) == rut
        course = entry.get("course", "") if valid else ""
        if course:
            index, score = match_doc(course, docs, list(range(len(docs))))
        elif GENERIC_FILE.match(rel[-1]):
            index, score = None, 0.0
        else:
            category = CATEGORY_KEYS.get(rel[1]) if len(rel) > 2 else None
            candidates = by_category.get(category) or list(range(len(docs)))
            index, score = match_doc(rel[-1], docs, candidates)
        if index is not None and entry.get("folio"):
            nami_codes.setdefault(index, Counter())[re.sub(r"^\d+-", "", entry["folio"])] += 1
        if index is not None:
            people[rut]["docs"].setdefault(str(index), "/".join(rel[1:]))
        report.append([rut, "/".join(rel[1:]), course, docs[index]["titulo"] if index is not None else "", f"{score:.2f}"])

    active_ruts = {normalize_rut(p.get("rut")) for p in snapshot.get("personas", [])}
    active = {rut: v for rut, v in people.items() if rut in active_ruts}
    for value in active.values():
        if not value["docs"]:
            del value["docs"]

    snapshot["namiLinks"] = {
        "version": 2,
        "updatedAt": updated_at,
        "base": base,
        "docOrder": [d["titulo"] for d in docs],
        "people": active,
        # Código interno de NAMI por curso (sale del folio del diploma, ej. RF-13 -> RF-018).
        "codes": {str(i): c.most_common(1)[0][0] for i, c in sorted(nami_codes.items())},
        "added": (snapshot.get("namiLinks") or {}).get("added", {}),
    }
    args.snapshot.write_text("window.AVANCE_RESSO_DATA = " + json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh, delimiter=";")
        writer.writerow(["rut", "archivo", "curso_en_pdf", "curso_asignado", "puntaje"])
        writer.writerows(report)

    matched = sum(1 for r in report if r[3])
    print(f"Carpeta base: {base}")
    print(f"Carpetas de trabajador en SharePoint: {len(people)} · activas en la tarja: {len(active)}")
    print(f"Carpetas de familia: {sum(len(v['categories']) for v in active.values())}")
    print(f"Archivos: {len(files)} · asociados a un curso: {matched} · sin asociar: {len(files) - matched}")
    print(f"Detalle de asociaciones: {args.report}")
    print(f"Actualización de la exportación: {updated_at or 'sin fecha'}")


if __name__ == "__main__":
    main()
