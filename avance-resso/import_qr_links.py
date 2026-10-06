"""Importa los enlaces de CERTIFICADOS QR (Forms) al snapshot privado de Avance RESSO.

Uso:
    python avance-resso/import_qr_links.py "<carpeta CERTIFICADOS QR>" --sharepoint-path "sites/ICSK-HSEC/.../Difusiones y capacitaciones/CERTIFICADOS QR"

La carpeta puede ser la copia local de build_qr_folders.py o la sincronizada con OneDrive: los
enlaces se arman con --sharepoint-path, así que funcionan una vez que la carpeta está subida con
la misma estructura <NOMBRE_RUT>/Riesgos_de_Fatalidad/<RUT>_RF-01.pdf. El curso sale de la sigla
del nombre del archivo; si hay más de un certificado del mismo curso (RUT_RF-02_2.pdf) se enlaza
el primero. En la matriz, el certificado NAMI tiene prioridad y el QR se enlaza cuando no hay NAMI.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILE = re.compile(r"^(\d{7,8}[0-9K])_RF-(\d+)(?:_(\d+))?\.pdf$", re.IGNORECASE)
RUT_SUFFIX = re.compile(r"_(\d{7,8}[0-9K])$", re.IGNORECASE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--sharepoint-path", required=True)
    parser.add_argument("--snapshot", type=Path, default=ROOT / "data" / "avance_resso_data.js")
    args = parser.parse_args()

    text = args.snapshot.read_text(encoding="utf-8")
    data = json.loads(text.split("=", 1)[1].strip().removesuffix(";"))
    docs = data["documentos"]
    by_code = {f"{int(m.group(1)):02d}": i for i, d in enumerate(docs) if (m := re.match(r"RF-(\d+)\s", d["titulo"]))}
    active = {re.sub(r"[^0-9K]", "", p["rut"].upper()) for p in data["personas"]}

    root = str(args.folder.resolve())
    if os.name == "nt" and not root.startswith("\\\\?\\"):
        root = "\\\\?\\" + root
    people: dict[str, dict] = {}
    newest, files, skipped = 0.0, 0, []
    for dirpath, _, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        for name in sorted(filenames, key=lambda n: (len(n), n)):  # RUT_RF-02.pdf antes que RUT_RF-02_2.pdf
            match = FILE.match(name)
            folder = rel_dir.split("/")[0]
            folder_rut = (RUT_SUFFIX.search(folder) or [None, ""])[1].upper()
            if not match or match.group(1).upper() != folder_rut or match.group(2).zfill(2) not in by_code:
                skipped.append(f"{rel_dir}/{name}")
                continue
            files += 1
            newest = max(newest, os.stat(os.path.join(dirpath, name)).st_mtime)
            if folder_rut not in active:
                continue
            entry = people.setdefault(folder_rut, {"folder": folder, "docs": {}})
            entry["docs"].setdefault(str(by_code[match.group(2).zfill(2)]), "/".join(rel_dir.split("/")[1:] + [name]))

    data["qrLinks"] = {
        "version": 1,
        "updatedAt": datetime.fromtimestamp(newest).strftime("%Y-%m-%d %H:%M") if newest else "",
        "base": args.sharepoint_path.strip("/"),
        "docOrder": [d["titulo"] for d in docs],
        "people": people,
    }
    args.snapshot.write_text("window.AVANCE_RESSO_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")

    nami = (data.get("namiLinks") or {}).get("people", {})
    cells = sum(len(v["docs"]) for v in people.values())
    only_qr = sum(1 for rut, v in people.items() for i in v["docs"] if i not in nami.get(rut, {}).get("docs", {}))
    print(f"Archivos QR: {files} · trabajadores en la matriz: {len(people)} · celdas con certificado QR: {cells}"
          f" (sin NAMI: {only_qr}, con NAMI: {cells - only_qr})")
    for path in skipped:
        print("  omitido:", path)


if __name__ == "__main__":
    main()
