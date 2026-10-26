"""Importa los enlaces de CERTIFICADOS QR (Forms) al snapshot privado de Avance RESSO.

Uso:
    python avance-resso/import_qr_links.py "<carpeta CERTIFICADOS QR>" --sharepoint-path "sites/ICSK-HSEC/.../Difusiones y capacitaciones/CERTIFICADOS QR"

La carpeta puede ser la copia local de build_qr_folders.py o la sincronizada con OneDrive: los
enlaces se arman con --sharepoint-path, así que funcionan una vez que la carpeta está subida con
la misma estructura <NOMBRE_RUT>/Riesgos_de_Fatalidad/<RUT>_RF-01.pdf. El curso sale de la sigla
del nombre del archivo; si hay más de un certificado del mismo curso (RUT_RF-02_2.pdf) se enlaza
el primero. En la matriz, el certificado NAMI tiene prioridad y el QR se enlaza cuando no hay NAMI.

Con --key fisicoLinks importa CERTIFICADOS FISICOS (evaluaciones en papel escaneadas, misma estructura);
en la matriz se enlazan cuando no hay certificado NAMI ni QR.

Con --key irlLinks importa CERTIFICADOS FISICOS (<NOMBRE_RUT>/IRL_y_otras_capacitaciones/<RUT>_IRL-xxxx.pdf). Cada archivo
va solo a su columna de IRL (IRL_CURSO): 2026 y pack 2026 -> Actualización IRL; 2025, sin fecha, evaluaciones y
realizadas 2025 -> IRL versión antigua; anexo -> Anexo IRL Junio 2026.
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
FILE_IRL = re.compile(r"^(\d{7,8}[0-9K])_(IRL-[A-Z0-9]+)\.pdf$", re.IGNORECASE)
IRL_CURSO = {
    "IRL-2026": "Actualización IRL por Especialidad", "IRL-PACK26": "Actualización IRL por Especialidad",
    "IRL-2025": "IRL por Especialidad (versión antigua)", "IRL-SINFECHA": "IRL por Especialidad (versión antigua)",
    "IRL-EVAL25": "IRL por Especialidad (versión antigua)", "IRL-REAL25": "IRL por Especialidad (versión antigua)",
    "IRL-OBS25": "IRL por Especialidad (versión antigua)", "IRL-ANEXO": "Anexo IRL Junio 2026",
}
RUT_SUFFIX = re.compile(r"_(\d{7,8}[0-9K])$", re.IGNORECASE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", type=Path)
    parser.add_argument("--sharepoint-path", required=True)
    parser.add_argument("--snapshot", type=Path, default=ROOT / "data" / "avance_resso_data.js")
    parser.add_argument("--key", default="qrLinks", choices=["qrLinks", "fisicoLinks", "irlLinks"], help="capa a importar")
    args = parser.parse_args()

    text = args.snapshot.read_text(encoding="utf-8")
    data = json.loads(text.split("=", 1)[1].strip().removesuffix(";"))
    docs = data["documentos"]
    by_code = {f"{int(m.group(1)):02d}": i for i, d in enumerate(docs) if (m := re.match(r"RF-(\d+)\s", d["titulo"]))}
    titulos = {d["titulo"]: i for i, d in enumerate(docs)}
    active = {re.sub(r"[^0-9K]", "", p["rut"].upper()) for p in data["personas"]}

    root = str(args.folder.resolve())
    if os.name == "nt" and not root.startswith("\\\\?\\"):
        root = "\\\\?\\" + root
    people: dict[str, dict] = {}
    newest, files, skipped = 0.0, 0, []
    for dirpath, _, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        for name in sorted(filenames, key=lambda n: (len(n), n)):  # RUT_RF-02.pdf antes que RUT_RF-02_2.pdf
            folder = rel_dir.split("/")[0]
            folder_rut = (RUT_SUFFIX.search(folder) or [None, ""])[1].upper()
            if args.key == "irlLinks":
                m = FILE_IRL.match(name)
                idx = titulos.get(IRL_CURSO.get(m.group(2).upper(), "")) if m else None
                if not m or m.group(1).upper() != folder_rut or idx is None:
                    skipped.append(f"{rel_dir}/{name}")
                    continue
                files += 1
                newest = max(newest, os.stat(os.path.join(dirpath, name)).st_mtime)
                if folder_rut in active:
                    entry = people.setdefault(folder_rut, {"folder": folder, "docs": {}})
                    entry["docs"].setdefault(str(idx), "/".join(rel_dir.split("/")[1:] + [name]))
                continue
            match = FILE.match(name)
            if not match or match.group(1).upper() != folder_rut or match.group(2).zfill(2) not in by_code:
                skipped.append(f"{rel_dir}/{name}")
                continue
            files += 1
            newest = max(newest, os.stat(os.path.join(dirpath, name)).st_mtime)
            if folder_rut not in active:
                continue
            entry = people.setdefault(folder_rut, {"folder": folder, "docs": {}})
            entry["docs"].setdefault(str(by_code[match.group(2).zfill(2)]), "/".join(rel_dir.split("/")[1:] + [name]))

    if args.key == "irlLinks":
        # Columnas IRL aprobadas sin archivo propio: enlace a la carpeta IRL de la persona (IRL_y_otras_capacitaciones).
        cols = [titulos[c] for c in sorted(set(IRL_CURSO.values())) if c in titulos]
        por_rut = {re.sub(r"[^0-9K]", "", p["rut"].upper()).lstrip("0"): p for p in data["personas"]}
        carpetas = 0
        for rut, entry in people.items():
            p = por_rut.get(rut.lstrip("0")) or por_rut.get(rut)
            for i in cols:
                if p and p["aprob"][i] == "1" and str(i) not in entry["docs"]:
                    entry["docs"][str(i)] = "IRL_y_otras_capacitaciones"; carpetas += 1
        print(f"[irlLinks] celdas IRL aprobadas enlazadas a la carpeta de la persona: {carpetas}")
    data[args.key] = {
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
    print(f"[{args.key}] archivos: {files} · trabajadores en la matriz: {len(people)} · celdas con certificado: {cells}"
          f" (sin NAMI: {only_qr}, con NAMI: {cells - only_qr})")
    for path in skipped:
        print("  omitido:", path)


if __name__ == "__main__":
    main()
