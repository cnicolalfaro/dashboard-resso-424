import re
from collections import Counter

from .catalog import ALIASES, normalize, rut, workbook_rows


MODULE = re.compile(r"^[A-Za-z]{2,5}-\d{2,4}$")
GROUPS = {"cuadrilla", "equipo", "grupo", "numero de cuadrilla", "n de cuadrilla"}
LABEL = re.compile(r"^\s*(?:cuadrilla\s+)?(\d{1,4})\s*[-–—:]\s*(.+?)\s*$", re.IGNORECASE)
HEADER_SEARCH_ROWS = 60


def _header_names(values):
    return [ALIASES.get(normalize(value), normalize(value)) for value in values]


def crew_label(label):
    match = LABEL.match(label)
    if not match:
        return None, ""
    return match.group(1), " ".join(match.group(2).split())


def read_shifts(path, roster_sheet="TARJA"):
    """Map RUT to the TURNO text of the TARJA roster sheet (e.g. '10X10 B' or '10X10 B-N')."""
    shifts = {}
    for sheet, rows in workbook_rows(path):
        if normalize(sheet) != normalize(roster_sheet):
            continue
        header = None
        for number, values in enumerate(rows):
            if header is None:
                if number > HEADER_SEARCH_ROWS:
                    break
                names = _header_names(values)
                if "rut" in names and "turno" in names:
                    header = (names.index("rut"), names.index("turno"))
                continue
            rut_index, shift_index = header
            if max(rut_index, shift_index) >= len(values) or values[rut_index] in (None, ""):
                continue
            try:
                identifier = rut(values[rut_index])
            except ValueError:
                continue
            text = " ".join(str(values[shift_index] or "").split()).upper()
            if text:
                shifts[identifier] = text
    return shifts


def tokens(text):
    return tuple(sorted(normalize(text).split()))


def is_night(shift):
    """TURNO such as '10X10 A-N' marks night: it ends in N after a hyphen or space."""
    return bool(re.search(r"(?:^|[\s-])N$", str(shift or "").strip().upper()))


def find_foreman(foreman, participants, by_name):
    key = tokens(foreman)
    if not key:
        return None
    for person in participants:
        if tokens(person["nombre"]) == key:
            return person["rut"]
    matches = by_name.get(key, [])
    return matches[0] if len(matches) == 1 else None


def crew_shift(participants, shifts, foreman_rut=None):
    """The foreman's TURNO decides; without it, the majority of the crew (ties follow the first)."""
    members = [("NOCHE" if is_night(shifts[person["rut"]]) else "DIA")
               for person in participants if person["rut"] in shifts]
    if foreman_rut in shifts:
        decided = "NOCHE" if is_night(shifts[foreman_rut]) else "DIA"
        return decided, any(member != decided for member in members), "capataz"
    if not members:
        return None, False, None
    counts = Counter(members)
    top = max(counts.values())
    winners = [value for value, number in counts.items() if number == top]
    return (members[0] if len(winners) > 1 else winners[0]), len(counts) > 1, "mayoría"


def read_crews(path, people, known, shifts=None):
    """Read crews by header names; the foreman is the name inside 'Cuadrilla N - NAME'."""
    for _, rows in workbook_rows(path):
        header = None
        grouped = {}
        for number, values in enumerate(rows):
            if header is None:
                if number > HEADER_SEARCH_ROWS:
                    break
                names = _header_names(values)
                group = next((name for name in names if name in GROUPS), None)
                if "rut" in names and group:
                    header = (names.index("rut"), names.index(group))
                continue
            rut_index, group_index = header
            if max(rut_index, group_index) >= len(values) or values[rut_index] in (None, ""):
                continue
            label = " ".join(str(values[group_index] or "").split())
            if not label:
                continue
            try:
                identifier = rut(values[rut_index])
            except ValueError:
                grouped.setdefault(label, []).append((None, "RUT inválido"))
                continue
            grouped.setdefault(label, []).append((identifier, None))
        if header is None:
            continue
        return _build_crews(grouped, people, known, shifts or {})
    raise ValueError("Cuadrillas requiere una hoja con columnas RUT y CUADRILLA")


def _build_crews(grouped, people, known, shifts):
    crews, used, warnings = [], set(), {"sin_capataz": 0, "excluidos": 0, "repetidos": 0, "turno_mixto": 0,
                                        "capataz_no_hallado": 0}
    seen_in = {}
    by_name = {}
    for identifier_rut, person in people.items():
        by_name.setdefault(tokens(person["nombre"]), []).append(identifier_rut)
    for label, members in grouped.items():
        number, foreman = crew_label(label)
        identifier = number or re.sub(r"[^A-Za-z0-9_-]+", "-", label).strip("-")[:64] or "sin-id"
        base, suffix = identifier, 1
        while identifier in used:
            suffix += 1
            identifier = f"{base}-{suffix}"
        used.add(identifier)
        if not foreman:
            warnings["sin_capataz"] += 1
        participants, excluded, ruts = [], [], set()
        for identifier_rut, problem in members:
            if identifier_rut is None:
                excluded.append({"rut": "", "motivo": problem})
            elif identifier_rut in ruts:
                warnings["repetidos"] += 1
            elif identifier_rut in people:
                ruts.add(identifier_rut)
                participants.append(dict(people[identifier_rut]))
                seen_in.setdefault(identifier_rut, []).append(identifier)
            else:
                ruts.add(identifier_rut)
                reason = "No está vigente en la TARJA" if identifier_rut in known else "No figura en la TARJA"
                excluded.append({"rut": identifier_rut, "motivo": reason})
        warnings["excluidos"] += len(excluded)
        foreman_rut = find_foreman(foreman, participants, by_name)
        if foreman_rut and foreman_rut not in ruts:
            ruts.add(foreman_rut)
            participants.append(dict(people[foreman_rut]))
        for person in participants:
            if person["rut"] == foreman_rut:
                person["capataz"] = True
        if foreman and not foreman_rut:
            warnings["capataz_no_hallado"] += 1
        participants.sort(key=lambda person: normalize(person["nombre"]))
        shift, mixed, source = crew_shift(participants, shifts, foreman_rut)
        warnings["turno_mixto"] += 1 if mixed else 0
        crews.append({"id": identifier, "name": label[:100], "foreman": foreman, "foreman_found": bool(foreman_rut),
                      "shift": shift, "shift_mixed": mixed, "shift_source": source,
                      "participants": participants, "excluded": excluded})
    warnings["en_varias_cuadrillas"] = sum(1 for value in seen_in.values() if len(value) > 1)
    crews = [crew for crew in crews if crew["participants"]]
    if not crews:
        raise ValueError("Ninguna cuadrilla tiene personas vigentes en la TARJA")
    return {"crews": crews, "warnings": warnings}


def read_matrix(path):
    """Read approvals by header names: RUT plus module columns such as RF-034."""
    workers, legend, columns = {}, {}, None
    for sheet, rows in workbook_rows(path):
        if "leyenda" in normalize(sheet):
            for values in rows:
                cells = [str(value).strip() for value in values if value not in (None, "")]
                if len(cells) >= 2 and MODULE.fullmatch(cells[0]):
                    legend[cells[0].upper()] = " ".join(cells[1].split())
            continue
        if columns is not None:
            continue
        header = None
        for number, values in enumerate(rows):
            if header is None:
                if number > HEADER_SEARCH_ROWS:
                    break
                names = [normalize(value) for value in values]
                modules = {str(value).strip().upper(): index for index, value in enumerate(values)
                           if isinstance(value, str) and MODULE.fullmatch(value.strip())}
                if "rut" in names and modules:
                    header = (names.index("rut"), modules)
                continue
            rut_index, modules = header
            if rut_index >= len(values) or values[rut_index] in (None, ""):
                continue
            try:
                identifier = rut(values[rut_index])
            except ValueError:
                continue
            status = {code: index < len(values) and normalize(values[index]) == "aprobado"
                      for code, index in modules.items()}
            previous = workers.get(identifier)
            if previous:
                status = {code: previous[code] or status[code] for code in status}
            workers[identifier] = status
        if header is not None:
            columns = list(header[1])
    if not workers:
        raise ValueError("La matriz requiere columna RUT y módulos como RF-034")
    return {"workers": workers, "legend": legend, "modules": columns}


def matrix_courses(legend):
    courses = []
    for code, title in legend.items():
        if not code.startswith("RF-"):
            continue
        match = re.search(r"\bRF-0*(\d+)\b", title, re.IGNORECASE)
        number = int(match.group(1)) if match else None
        courses.append({"id": code, "code": f"RF-{number:02d}" if number is not None else code,
                        "title": title, "content": title, "number": number})
    return sorted(courses, key=lambda course: (course["number"] is None, course["number"] or 0, course["id"]))


def select_pending(crew, courses, matrix):
    """Keep people lacking any selected course; people absent from the matrix stay, flagged."""
    included, approved = [], 0
    for person in crew["participants"]:
        record = matrix["workers"].get(person["rut"])
        pending = [course["id"] for course in courses
                   if record is None or not record.get(course["id"], False)]
        if pending:
            included.append({**person, "pending": pending,
                             "matrix": "sin_matriz" if record is None else "pendiente"})
        else:
            approved += 1
    return included, approved


SMALL_CREW = 4
SHEET_LIMIT = 15
GROUP_CREWS = 6


def plan_groups(items, small=SMALL_CREW, limit=SHEET_LIMIT, max_crews=GROUP_CREWS):
    """Pack small crews of the same shift into shared sheets.

    items: [{'id', 'shift', 'pending'}] in the order given. Larger crews, crews without people
    to include and crews with an unknown shift stay on their own. Returns a list of id lists.
    """
    groups, open_by_shift = [], {}
    for item in items:
        if not 0 < item["pending"] <= small or item["shift"] is None:
            groups.append([item["id"]])
            continue
        current = open_by_shift.get(item["shift"])
        if current and current["people"] + item["pending"] <= limit and len(current["ids"]) < max_crews:
            current["ids"].append(item["id"])
            current["people"] += item["pending"]
            continue
        ids = [item["id"]]
        groups.append(ids)
        open_by_shift[item["shift"]] = {"ids": ids, "people": item["pending"]}
    return groups