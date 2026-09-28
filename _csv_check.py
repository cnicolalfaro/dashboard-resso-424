import csv, re, sys, json

PATH = "Consolidado Incidentes y Medidas Correctivas (Formato Interno) 05.08.csv"

def key(v):
    v = (v or "").strip().lower()
    v = v.replace("\u00e1","a").replace("\u00e9","e").replace("\u00ed","i").replace("\u00f3","o").replace("\u00fa","u").replace("\u00f1","n")
    return re.sub(r"[^a-z0-9]", "", v)

rows = []
with open(PATH, "r", encoding="latin-1", newline="") as fh:
    for r in csv.reader(fh, delimiter=";"):
        rows.append(r)

hidx = None
for i, r in enumerate(rows):
    ks = [key(c) for c in r]
    if "item" in ks and "nombredelevento" in ks:
        hidx = i
        break
if hidx is None:
    sys.exit("header not found")

headers = [key(c) for c in rows[hidx]]
print("HEADER ROW:", hidx)
print("HEADERS:", [h for h in headers if h][:30])

def col(*names):
    for n in names:
        if n in headers:
            return headers.index(n)
    return -1

C = {
    "item": col("item"), "fecha": col("fecha"), "turno": col("turno"),
    "nombre": col("nombredelevento"), "categoria": col("categoria"),
    "incidente": col("incidente"), "medida": col("medidacorrectiva"),
    "responsable": col("responsable"),
    "cierre": col("fechacierreaccion", "fechacierreaccin", "fechacierre"),
    "estatus": col("estatus"),
    "verifm": col("verificacionmedidas", "verificacinmedidas"), "verife": col("verificaciondeeficacia", "verificacioneficacia", "verificacindeeficacia"),
    "comentarios": col("comentarios"), "area": col("area", "sector"),
}
print("COLS:", C)

def val(r, c):
    return (r[c].strip() if 0 <= c < len(r) else "")

incidents = []
cur = None
for r in rows[hidx+1:]:
    item = val(r, C["item"])
    if item:
        cur = {"item": item, "nombre": val(r, C["nombre"]), "fecha": val(r, C["fecha"]),
               "categoria": val(r, C["categoria"]), "area": val(r, C["area"]),
               "incidente": val(r, C["incidente"]), "medidas": []}
        incidents.append(cur)
    if cur is None:
        continue
    m = val(r, C["medida"])
    if m:
        cur["medidas"].append({"medida": m, "resp": val(r, C["responsable"]),
                               "cierre": val(r, C["cierre"]), "estatus": val(r, C["estatus"])})

print("TOTAL INCIDENTES:", len(incidents))
nums = []
for inc in incidents:
    mm = re.match(r"^(\d+)", inc["item"])
    if mm:
        nums.append(int(mm.group(1)))
print("RANGO ITEM:", min(nums), "-", max(nums))
faltantes = sorted(set(range(min(nums), max(nums)+1)) - set(nums))
print("FALTANTES:", faltantes)
dups = sorted({n for n in nums if nums.count(n) > 1})
print("DUPLICADOS:", dups)

def pdate(t):
    t = (t or "").strip()
    m = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$", t)
    if m:
        y = int(m.group(3))
        y = 2000 + y if y < 100 else y
        return (y, int(m.group(2)), int(m.group(1)))
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None

print("\n--- FECHAS CIERRE ANTERIORES AL INCIDENTE ---")
import datetime
for inc in incidents:
    f = pdate(inc["fecha"])
    if not f:
        continue
    d0 = datetime.date(*f)
    for m in inc["medidas"]:
        c = pdate(m["cierre"])
        if not c:
            continue
        d1 = datetime.date(*c)
        if d1 < d0:
            print(f"ITEM {inc['item']} | incidente {inc['fecha']} | cierre {m['cierre']} | dif {(d1-d0).days} d | {inc['nombre'][:55]}")

print("\n--- FECHAS NO PARSEABLES / TEXTO EN CIERRE ---")
raros = {}
for inc in incidents:
    for m in inc["medidas"]:
        c = m["cierre"].strip()
        if c and not pdate(c):
            raros.setdefault(c.upper(), []).append(inc["item"])
for k, v in sorted(raros.items()):
    print(f"{k!r} -> items {sorted(set(v))[:12]}")

print("\n--- INCIDENTES SIN FECHA ---")
for inc in incidents:
    if not pdate(inc["fecha"]):
        print(f"ITEM {inc['item']} | fecha={inc['fecha']!r} | {inc['nombre'][:60]}")

print("\n--- ULTIMOS 12 ITEMS ---")
for inc in incidents[-12:]:
    print(f"ITEM {inc['item']} | {inc['fecha']} | {inc['categoria']} | {inc['nombre'][:70]} | medidas={len(inc['medidas'])}")

with open("_csv_items.json", "w", encoding="utf-8") as fh:
    json.dump([{k: inc[k] for k in ("item","fecha","categoria","nombre")} | {"medidas": len(inc["medidas"])} for inc in incidents], fh, ensure_ascii=False, indent=1)
