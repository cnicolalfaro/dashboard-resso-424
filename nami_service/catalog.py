import json
import datetime
import re
import unicodedata
import zipfile
from pathlib import Path

from openpyxl import load_workbook
from pyxlsb import open_workbook
from openpyxl.utils.datetime import from_excel


FIELDS = ("nombre", "rut", "cargo", "especialidad", "rol", "estado")
ALIASES = {
    "name": "nombre", "nombres": "nombre", "nombre completo": "nombre",
    "a paterno": "apellido_paterno", "apellido paterno": "apellido_paterno",
    "a materno": "apellido_materno", "apellido materno": "apellido_materno",
    "categoria": "cargo", "category": "cargo",
    "fe fin": "fecha_fin", "fe_fin": "fecha_fin", "fecha fin": "fecha_fin",
    "fecha finiquito": "fecha_fin", "fecha termino": "fecha_fin",
    "fecha ingreso": "fecha_activa", "fe_ing": "fecha_activa", "fe ing": "fecha_activa",
    "fecha reingreso": "fecha_activa", "fecha efectiva": "fecha_activa",
    "fecha actualizacion": "fecha_activa", "status": "estado",
}


def normalize(value):
    text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def rut(value):
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError("Numeric RUT must be integral")
        value = int(value)
    text = re.sub(r"[.\s-]", "", str(value or "")).upper()
    if not re.fullmatch(r"\d{7,8}[\dK]", text):
        raise ValueError("Invalid RUT")
    body, check = text[:-1], text[-1]
    total = sum(int(c) * (2 + i % 6) for i, c in enumerate(reversed(body)))
    expected = 11 - total % 11
    expected = "K" if expected == 10 else "0" if expected == 11 else str(expected)
    if check != expected:
        raise ValueError("Invalid RUT checksum")
    return f"{int(body)}-{check}"


def workbook_rows(path):
    if path.suffix.lower() == ".xlsb":
        with open_workbook(str(path)) as book:
            for name in book.sheets:
                with book.get_sheet(name) as sheet:
                    yield name, ([cell.v for cell in row] for row in sheet.rows())
    elif path.suffix.lower() in {".xlsx", ".xlsm"}:
        book = load_workbook(path, read_only=True, data_only=True, keep_links=False)
        try:
            for sheet in book:
                yield sheet.title, sheet.iter_rows(values_only=True)
        finally:
            book.close()
    else:
        raise ValueError("TARJA must be xlsb, xlsx or xlsm")


def effective_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    if isinstance(value, (int, float)):
        converted = from_excel(value)
        if isinstance(converted, datetime.datetime):
            return converted.date()
    text = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(text[:10], pattern).date()
        except ValueError:
            pass
    raise ValueError("Invalid TARJA effective date")


def import_tarja(path, include_known=False, roster_sheet="TARJA"):
    if not path.is_absolute() or not path.is_file():
        raise ValueError("NAMI_TARJA_PATH must identify an absolute readable workbook")
    if path.stat().st_size > 40 * 1024 * 1024:
        raise ValueError("TARJA exceeds size limit")
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 5000 or sum(entry.file_size for entry in entries) > 100 * 1024 * 1024:
            raise ValueError("TARJA expanded size exceeds limit")
    if not isinstance(roster_sheet, str) or not roster_sheet.strip() or len(roster_sheet) > 100:
        raise ValueError("Configure an explicit roster worksheet")
    candidates, events, known = {}, {}, set()
    today = datetime.date.today()
    roster_seen = False
    roster_header_seen = False
    count = 0
    for sheet, rows in workbook_rows(path):
        header = None
        terminated_sheet = "finiquit" in normalize(sheet)
        is_roster = normalize(sheet) == normalize(roster_sheet)
        if terminated_sheet and is_roster:
            raise ValueError("Finiquitados cannot be the current personnel roster")
        if not is_roster and not terminated_sheet and normalize(sheet) != "maestra":
            continue
        roster_seen = roster_seen or is_roster
        priority = 30 if normalize(sheet) == "maestra" else 20 if normalize(sheet) == "tarja" else 10
        for values in rows:
            count += 1
            if count > 100000:
                raise ValueError("TARJA exceeds row limit")
            if header is None:
                names = [ALIASES.get(normalize(v), normalize(v)) for v in values]
                expected = ("rut", "nombre", "cargo", "especialidad") if is_roster else (
                    ("rut",) if terminated_sheet else ("rut", "estado"))
                if all(field in names for field in expected):
                    keys = set(FIELDS) | {"apellido_paterno", "apellido_materno", "fecha_fin", "fecha_activa"}
                    header = {field: names.index(field) for field in keys if field in names}
                    roster_header_seen = roster_header_seen or is_roster
                continue
            raw = {key: values[index] if index < len(values) else None for key, index in header.items()}
            if not raw.get("rut"):
                continue
            identifier = rut(raw["rut"])
            known.add(identifier)
            item = {field: str(raw[field]).strip() if raw.get(field) is not None else ""
                    for field in FIELDS if field != "estado"}
            item["rut"] = identifier
            item["nombre"] = " ".join(str(raw.get(key) or "").strip()
                                      for key in ("nombre", "apellido_paterno", "apellido_materno")
                                      if str(raw.get(key) or "").strip())
            state = normalize(raw.get("estado"))
            terminated = terminated_sheet or any(token in state for token in ("finiquit", "inactivo", "baja"))
            active = state in {"activo", "activa", "vigente", "active"} or (
                not state and not terminated_sheet and all(key in header for key in ("nombre", "cargo", "especialidad")))
            date = effective_date(raw.get("fecha_fin") if terminated else raw.get("fecha_activa"))
            if terminated or active:
                events.setdefault(identifier, []).append(
                    {"active": active and not terminated, "date": date,
                     "priority": 0 if terminated_sheet else priority})
            if not is_roster:
                continue
            if date is not None and date > today:
                if active:
                    continue
                # Scheduled departures do not remove a currently listed person before their effective date.
                events.setdefault(identifier, []).append({"active": True, "date": None, "priority": priority})
            if not item["nombre"] or any(len(item[field]) > 1000 for field in item):
                raise ValueError("Invalid TARJA participant")
            previous = candidates.get(identifier)
            rank = (30, date or datetime.date.min)
            if previous and previous[0] == rank and previous[1] != item:
                raise ValueError("Ambiguous duplicate TARJA RUT")
            if previous is None or rank > previous[0]:
                candidates[identifier] = (rank, item)
    people = {}
    for identifier, (_, person) in candidates.items():
        current = [event for event in events.get(identifier, []) if event["date"] is None or event["date"] <= today]
        if not current:
            continue
        authoritative = max(current, key=lambda event: (
            event["priority"], event["date"] or datetime.date.min, not event["active"]))
        # Effective dated events outrank undated status; only a later dated rehire can undo a departure.
        # Departure wins equal-date ties, and future events do not affect today's roster.
        dated = [event for event in current if event["date"] is not None]
        if dated:
            authoritative = max(dated, key=lambda event: (event["date"], not event["active"], event["priority"]))
        if authoritative["active"]:
            people[identifier] = person
    if not roster_seen or not roster_header_seen:
        raise ValueError("Configure a roster worksheet with RUT/name/cargo/especialidad headers")
    if not known:
        raise ValueError("TARJA requires a recognized RUT header and participants")
    return (people, known) if include_known else people


def load_catalog(root, tarja, roster_sheet="TARJA"):
    source = root / "catalog.json"
    if source.stat().st_size > 1024 * 1024:
        raise ValueError("Catalog exceeds size limit")
    data = json.loads(source.read_text(encoding="utf-8"))
    people, known = import_tarja(Path(tarja), include_known=True, roster_sheet=roster_sheet)
    courses = data["courses"]
    if not isinstance(courses, list) or not 1 <= len(courses) <= 100:
        raise ValueError("Configure private RF courses")
    course_ids = set()
    for item in courses:
        if not isinstance(item, dict) or set(item) != {"id", "code", "title", "content"}:
            raise ValueError("Courses require id/code/title/content")
        if any(not isinstance(v, str) or not v.strip() or len(v) > 4000 for v in item.values()):
            raise ValueError("Invalid course")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", item["id"]) or item["id"] in course_ids:
            raise ValueError("Invalid/duplicate course id")
        if not item["code"].upper().startswith("RF"):
            raise ValueError("Only configured RF courses are supported")
        course_ids.add(item["id"])
    crews, ids = [], set()
    if not isinstance(data["crews"], list) or not 1 <= len(data["crews"]) <= 100:
        raise ValueError("Configure a bounded private crew catalog")
    for crew in data["crews"]:
        identifier = str(crew["id"])
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", identifier) or identifier in ids:
            raise ValueError("Invalid/duplicate crew id")
        ids.add(identifier)
        memberships = [rut(value) for value in crew["ruts"]]
        if len(memberships) != len(set(memberships)) or not memberships:
            raise ValueError("Crew membership must be explicit and unique")
        if any(value not in known for value in memberships):
            raise ValueError("Crew includes unknown RUT")
        if (len(memberships) > 500 or not isinstance(crew["name"], str) or
                not crew["name"].strip() or len(crew["name"]) > 100):
            raise ValueError("Invalid crew")
        participants = [people[value] for value in memberships if value in people]
        if participants:
            crews.append({"id": identifier, "name": crew["name"], "participants": participants})
    return {"crews": crews, "courses": courses}
