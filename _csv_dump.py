import csv, re

NEW = "Consolidado Incidentes y Medidas Correctivas (Formato Interno) 05.08.csv"
with open(NEW, "r", encoding="utf-8", errors="replace", newline="") as fh:
    rows = list(csv.reader(fh, delimiter=";"))

hidx = 1
want = {"51", "67", "71", "78", "94", "96", "99", "100"}
cur = None
for r in rows[hidx + 1:]:
    item = (r[0] or "").strip()
    if item:
        cur = item.split(".")[0].strip()
        if cur in want:
            print(f"\n########## ITEM {cur} | fecha={r[1]!r} turno={r[2]!r}")
            print(f"  NOMBRE: {r[3]!r}")
            print(f"  CATEG : {r[4]!r}")
            print(f"  INCID : {r[5]!r}")
    if cur not in want:
        continue
    vals = {"medida": r[6], "resp": r[7], "cierre": r[8], "estatus": r[9],
            "verifm": r[10], "verife": r[11], "coment": r[12]}
    if any(v.strip() for v in vals.values()):
        print("   ROW:", {k: v for k, v in vals.items() if v.strip()})
