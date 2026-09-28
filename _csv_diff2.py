import csv, re
import openpyxl

OLD = "Consolidado Incidentes y Medidas Correctivas (Formato Interno) 05.08.2026.xlsx"
NEW = "Consolidado Incidentes y Medidas Correctivas (Formato Interno) 05.08.csv"

ACCENTS = str.maketrans("ÁÉÍÓÚÜÑáéíóúüñ", "AEIOUUNaeiouun")


def fold(v):
    """Reduce a comparable ASCII skeleton: accents and U+FFFD collapse away."""
    s = str(v if v is not None else "")
    s = s.translate(ACCENTS)
    s = s.upper()
    s = re.sub(r"[^A-Z0-9/\-.: ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def key(v):
    return re.sub(r"[^a-z0-9]", "", fold(v).lower())


def norm_date(v):
    s = str(v or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s)
    if m:
        y = m.group(3)
        y = "20" + y if len(y) == 2 else y
        return f"{int(m.group(1)):02d}-{int(m.group(2)):02d}-{y}"
    return fold(s)


def build(rows):
    hidx = next(i for i, r in enumerate(rows)
                if "item" in [key(c) for c in r] and "nombredelevento" in [key(c) for c in r])
    headers = [key(c) for c in rows[hidx]]

    def col(*names):
        for n in names:
            if n in headers:
                return headers.index(n)
        return -1

    C = {"item": col("item"), "fecha": col("fecha"), "turno": col("turno"),
         "nombre": col("nombredelevento"), "categoria": col("categoria"),
         "incidente": col("incidente"), "medida": col("medidacorrectiva"),
         "responsable": col("responsable"),
         "cierre": col("fechacierreaccion", "fechacierreaccin", "fechacierre"),
         "estatus": col("estatus"),
         "verifm": col("verificacionmedidas", "verificacinmedidas"),
         "verife": col("verificaciondeeficacia", "verificacindeeficacia", "verificacioneficacia"),
         "comentarios": col("comentarios")}

    def val(r, c):
        return str(r[c]).strip() if 0 <= c < len(r) and r[c] is not None else ""

    out, cur = [], None
    for r in rows[hidx + 1:]:
        item = val(r, C["item"])
        if item:
            cur = {"item": item.split(".")[0].strip(),
                   "fecha": norm_date(val(r, C["fecha"])),
                   "turno": fold(val(r, C["turno"])),
                   "nombre": fold(val(r, C["nombre"])),
                   "categoria": fold(val(r, C["categoria"])),
                   "incidente": fold(val(r, C["incidente"])),
                   "verifm": fold(val(r, C["verifm"])),
                   "verife": fold(val(r, C["verife"])),
                   "comentarios": fold(val(r, C["comentarios"])),
                   "medidas": []}
            out.append(cur)
        if cur is None:
            continue
        m = val(r, C["medida"])
        if m:
            cur["medidas"].append({"medida": fold(m), "responsable": fold(val(r, C["responsable"])),
                                   "cierre": norm_date(val(r, C["cierre"])), "estatus": fold(val(r, C["estatus"]))})
        else:
            for f, c in (("verifm", C["verifm"]), ("verife", C["verife"])):
                v = fold(val(r, c))
                if v and not cur[f]:
                    cur[f] = v
    return {i["item"]: i for i in out}


wb = openpyxl.load_workbook(OLD, data_only=True)
old = build([[c for c in row] for row in wb[wb.sheetnames[0]].iter_rows(values_only=True)])
with open(NEW, "r", encoding="utf-8", errors="replace", newline="") as fh:
    new = build(list(csv.reader(fh, delimiter=";")))

order = lambda s: sorted(s, key=lambda x: int(re.match(r"\d+", x).group()))
print(f"ANTERIOR {len(old)} incidentes | NUEVO {len(new)} incidentes")
print("NUEVOS:", order(set(new) - set(old)))
print("ELIMINADOS:", order(set(old) - set(new)))
print("\n=== DIFERENCIAS REALES (ignorando acentos) ===")
FIELDS = ["fecha", "turno", "nombre", "categoria", "incidente", "verifm", "verife", "comentarios"]
for k in order(set(old) & set(new)):
    a, b = old[k], new[k]
    diffs = []
    for f in FIELDS:
        if a[f] != b[f]:
            diffs.append(f"    {f}:\n       antes: {a[f][:120]}\n       ahora: {b[f][:120]}")
    if len(a["medidas"]) != len(b["medidas"]):
        diffs.append(f"    medidas: {len(a['medidas'])} -> {len(b['medidas'])}")
    else:
        for n, (ma, mb) in enumerate(zip(a["medidas"], b["medidas"]), 1):
            for f in ("medida", "responsable", "cierre", "estatus"):
                if ma[f] != mb[f]:
                    diffs.append(f"    medida #{n} {f}: {ma[f][:70]!r} -> {mb[f][:70]!r}")
    if diffs:
        print(f"\nITEM {k}  ({b['nombre'][:60]})")
        print("\n".join(diffs))

print("\n=== ITEM(S) NUEVO(S) EN DETALLE ===")
for k in order(set(new) - set(old)):
    i = new[k]
    print(f"ITEM {k} | {i['fecha']} | turno {i['turno']} | {i['categoria']}")
    print(f"  Evento: {i['nombre']}")
    print(f"  Descripcion: {i['incidente'][:400]}")
    print(f"  Verif. medidas: {i['verifm']} | Verif. eficacia: {i['verife']}")
    print(f"  Comentarios: {i['comentarios'][:200]}")
    for n, m in enumerate(i["medidas"], 1):
        print(f"   {n}. {m['medida'][:110]} | resp {m['responsable']} | cierre {m['cierre']} | {m['estatus']}")
