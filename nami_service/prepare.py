import argparse
import datetime
import os
import re
import secrets
import sys
from pathlib import Path

import pymupdf as fitz

from .catalog import import_tarja
from .evaluations import make_evaluations
from .planillas import matrix_courses, read_crews, read_matrix, read_shifts, select_pending
from .templates import as_templates
from .word_register import RenderError, make_word_document


OBJECTIVES = ("Difundir a los trabajadores del contrato los cursos de Riesgos Fatales "
              "indicados en MATERIA(S) TRATADA(S).")
DEFAULT_HOME = Path.home() / ".local" / "share" / "nami"
SHIFT_FOLDERS = {"DIA": "Turno Día", "NOCHE": "Turno Noche", None: "Sin turno"}


def load_sources(tarja, crews, matrix, roster_sheet="TARJA"):
    people, known = import_tarja(Path(tarja), include_known=True, roster_sheet=roster_sheet)
    shifts = read_shifts(Path(tarja), roster_sheet)
    return {"people": people, "crews": read_crews(Path(crews), people, known, shifts),
            "matrix": read_matrix(Path(matrix))}


def merge_pdfs(*documents):
    merged = fitz.open()
    for data in documents:
        if data:
            with fitz.open(stream=data, filetype="pdf") as source:
                merged.insert_pdf(source)
    data = merged.tobytes(garbage=3, deflate=True)
    merged.close()
    return data


def resolve_courses(matrix, codes):
    by_code = {course["code"].upper(): course for course in matrix_courses(matrix["legend"])}
    courses, missing = [], []
    for code in codes:
        course = by_code.get(code.strip().upper())
        (courses if course else missing).append(course or code)
    if missing:
        raise ValueError("Cursos sin columna en la matriz: " + ", ".join(missing))
    if not 1 <= len(courses) <= 4 or len({course["id"] for course in courses}) != len(courses):
        raise ValueError("Seleccione de 1 a 4 cursos distintos")
    return courses


def find_crew(sources, crew_id):
    crew = next((item for item in sources["crews"]["crews"] if item["id"] == str(crew_id)), None)
    if crew is None:
        raise ValueError("Cuadrilla no encontrada")
    return crew


def compose_unit(sources, crew_ids, courses):
    """One crew, or several small crews of the same shift sharing a sheet."""
    ids = [str(crew_ids)] if isinstance(crew_ids, (str, int)) else [str(item) for item in crew_ids]
    crews = [find_crew(sources, item) for item in ids]
    if len(crews) == 1:
        pending, approved = select_pending(crews[0], courses, sources["matrix"])
        return crews[0], pending, approved
    if len({crew.get("shift") for crew in crews}) > 1:
        raise ValueError("No se pueden agrupar cuadrillas de distinto turno")
    pending, approved, seen = [], 0, set()
    for crew in crews:
        included, ok = select_pending(crew, courses, sources["matrix"])
        approved += ok
        for person in included:
            if person["rut"] in seen:
                continue
            seen.add(person["rut"])
            pending.append({**person, "crew_id": crew["id"], "crew_name": crew["name"],
                            "crew_label": f"Cuadrilla {crew['id']}", "foreman": crew.get("foreman", "")})
    composite = {"id": "+".join(crew["id"] for crew in crews),
                 "name": "CUADRILLAS " + ", ".join(crew["id"] for crew in crews),
                 "foreman": " / ".join(crew["foreman"] for crew in crews if crew.get("foreman")),
                 "shift": crews[0].get("shift"), "shift_mixed": any(crew.get("shift_mixed") for crew in crews),
                 "foreman_found": all(crew.get("foreman_found") for crew in crews),
                 "participants": [person for crew in crews for person in crew["participants"]],
                 "excluded": [item for crew in crews for item in crew["excluded"]],
                 "group": [{"id": crew["id"], "name": crew["name"], "foreman": crew.get("foreman", "")}
                           for crew in crews]}
    return composite, pending, approved


def prepare(sources, crew_ids, codes, date, templates, workdir, secret, objectives=OBJECTIVES):
    templates = as_templates(templates)
    courses = resolve_courses(sources["matrix"], codes)
    crew, pending, approved = compose_unit(sources, crew_ids, courses)
    if not pending:
        raise ValueError("Nadie en la cuadrilla tiene pendientes los cursos seleccionados")
    register_template = templates.register()
    if register_template is None:
        raise ValueError("Falta la plantilla privada del registro")
    manifest, register = make_word_document(register_template, crew, pending, courses, date, secret, workdir, objectives)
    with_template = templates.available(courses)
    evaluations, info = None, {"sheets": 0, "pages": 0}
    if with_template:
        evaluations, info = make_evaluations(templates, manifest, workdir)
    without_evaluation = [c["code"] for c in courses if c["id"] not in with_template]
    manifest["crew"]["shift"] = crew.get("shift")
    manifest["summary"] = {"members": len(crew["participants"]), "included": len(pending),
                           "already_approved": approved, "excluded": len(crew["excluded"]),
                           "without_matrix": sum(1 for p in pending if p["matrix"] == "sin_matriz"),
                           "foreman_found": crew.get("foreman_found", False),
                           "shift_mixed": crew.get("shift_mixed", False),
                           "evaluation_sheets": info["sheets"], "courses_without_evaluation": without_evaluation}
    return {"manifest": manifest, "register": register, "evaluations": evaluations,
            "combined": merge_pdfs(register, evaluations),
            "summary": {"crew": crew["name"], "foreman": crew.get("foreman", ""),
                        "shift": SHIFT_FOLDERS[crew.get("shift")], "shift_mixed": crew.get("shift_mixed", False),
                        "foreman_included": any(p.get("capataz") for p in pending),
                        "foreman_not_found": bool(crew.get("foreman")) and not crew.get("foreman_found"),
                        "members": len(crew["participants"]), "included": len(pending),
                        "already_approved": approved,
                        "without_matrix": manifest["summary"]["without_matrix"],
                        "excluded": len(crew["excluded"]), "pages": len(manifest["pages"]),
                        "evaluation_sheets": info["sheets"],
                        "courses_without_evaluation": without_evaluation}}


def private_directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_mode & 0o077 or path.stat().st_uid != os.geteuid():
        raise ValueError(f"{path} debe pertenecerte y tener permisos 0700")
    return path


def write_unique(directory, name, data):
    stem, suffix = name.rsplit(".", 1)
    for attempt in range(1, 100):
        path = directory / (name if attempt == 1 else f"{stem} ({attempt}).{suffix}")
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            continue
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        return path
    raise ValueError("Demasiadas copias del mismo archivo")


def safe_name(text):
    return re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", text)).strip(" .")[:90] or "cuadrilla"


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m nami_service.prepare",
                                     description="Vista previa privada: registro y evaluaciones de una cuadrilla.")
    parser.add_argument("--tarja", required=True)
    parser.add_argument("--cuadrillas", required=True)
    parser.add_argument("--matriz", required=True)
    parser.add_argument("--plantillas", default=str(DEFAULT_HOME / "templates"))
    parser.add_argument("--salida", default=str(DEFAULT_HOME / "salidas"))
    parser.add_argument("--hoja-tarja", default="TARJA")
    parser.add_argument("--cursos", nargs="+", default=["RF-01"], metavar="RF-NN")
    parser.add_argument("--fecha", default=datetime.date.today().isoformat())
    parser.add_argument("--cuadrilla", help="Número de cuadrilla a preparar")
    parser.add_argument("--listar", action="store_true", help="Lista las cuadrillas y sus pendientes")
    args = parser.parse_args(argv)
    sources = load_sources(args.tarja, args.cuadrillas, args.matriz, args.hoja_tarja)
    if args.listar or not args.cuadrilla:
        courses = resolve_courses(sources["matrix"], args.cursos)
        print(f"Cursos: {', '.join(c['code'] for c in courses)}")
        for crew in sources["crews"]["crews"]:
            pending, approved = select_pending(crew, courses, sources["matrix"])
            flag = " (turno mixto)" if crew.get("shift_mixed") else ""
            print(f"{crew['id']:>4} | {SHIFT_FOLDERS[crew.get('shift')]:<11}{flag} | "
                  f"{len(pending):>2} pendientes de {len(crew['participants']):>2} | {crew['name']}")
        return 0
    workdir = private_directory(private_directory(args.salida) / ".trabajo")
    result = prepare(sources, args.cuadrilla, args.cursos, args.fecha, args.plantillas, workdir,
                     secrets.token_urlsafe(48))
    base = private_directory(Path(args.salida) / args.fecha)
    directory = private_directory(base / result["summary"]["shift"])
    path = write_unique(directory, f"{safe_name(result['summary']['crew'])} (vista previa).pdf", result["combined"])
    for key, value in result["summary"].items():
        print(f"{key}: {value}")
    print("Archivo:", path, sep="\n  ")
    print("VISTA PREVIA: este registro no queda registrado en NAMI y su QR no sirve para escanear.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RenderError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
