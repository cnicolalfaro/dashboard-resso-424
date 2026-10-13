"""Registros compartidos entre instalaciones de NAMI.

Cada instalación tiene su base privada, pero un escaneo debe reconocerse en cualquier computador.
Con NAMI_SHARED_DIR (una carpeta común, p. ej. sincronizada con OneDrive de la empresa) cada
instalación publica ahí los manifiestos que genera (<id>.json + sus PDF) e incorpora los de las
demás a su base. Los manifiestos siguen siendo inmutables: solo se agregan los que faltan.
Los QR se validan con NAMI_QR_KEY (igual en todas) y las claves antiguas de NAMI_QR_TRUSTED_KEYS.
"""
import json
import os
import shutil
import uuid
from contextlib import closing
from pathlib import Path

from .storage import connect, transaction


def shared_dir(value, root, public=None):
    """Carpeta común validada, o None si no se configuró."""
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("NAMI_SHARED_DIR must be an absolute directory")
    path = path.resolve()
    repository = Path(__file__).resolve().parent.parent
    forbidden = [repository, root] + ([Path(public).resolve()] if public else [])
    if any(path == p or p in path.parents or path in p.parents for p in forbidden):
        raise ValueError("NAMI_SHARED_DIR must be separate from the repository, public root and private data")
    path.mkdir(parents=True, exist_ok=True)
    return path


def plain_name(name):
    return isinstance(name, str) and name and Path(name).name == name and not name.startswith(".")


def valid_manifest(manifest, record_id):
    return (isinstance(manifest, dict) and manifest.get("id") == record_id
            and isinstance(manifest.get("pages"), list) and isinstance(manifest.get("participants"), list)
            and isinstance(manifest.get("courses"), list) and isinstance(manifest.get("crew"), dict))


def copy_if_missing(source, target, mode=None):
    if not source.is_file() or target.exists():
        return False
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    shutil.copyfile(source, temporary)
    if mode is not None:
        os.chmod(temporary, mode)
    os.replace(temporary, target)
    return True


def sync_records(root, shared):
    """Publica los registros locales que faltan en la carpeta común e incorpora los ajenos."""
    result = {"exported": 0, "imported": 0, "skipped": 0}
    if shared is None:
        return result
    records = root / "records"
    with closing(connect(root)) as db:
        local = {row["id"]: (row["manifest"], row["pdf"]) for row in db.execute("SELECT id,manifest,pdf FROM records")}
    for record_id, (text, pdf) in local.items():
        target = shared / f"{record_id}.json"
        if not target.exists():
            temporary = shared / f".{record_id}.{uuid.uuid4().hex}.tmp"
            temporary.write_text(text, encoding="utf-8")
            os.replace(temporary, target)
            result["exported"] += 1
        for name in (pdf, json.loads(text).get("evaluations_pdf")):
            if plain_name(name):
                copy_if_missing(records / name, shared / name)
    for path in sorted(shared.glob("*.json")):
        try:
            record_id = str(uuid.UUID(path.stem))
        except ValueError:
            continue
        if record_id in local:
            continue
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            result["skipped"] += 1
            continue
        if not valid_manifest(manifest, record_id):
            result["skipped"] += 1
            continue
        evaluations = manifest.get("evaluations_pdf")
        if evaluations is not None and not plain_name(evaluations):
            result["skipped"] += 1
            continue
        pdf = f"{record_id}.pdf"
        for name in (pdf, evaluations):
            if name:
                copy_if_missing(shared / name, records / name, 0o600)
        with transaction(root) as db:
            db.execute("INSERT OR IGNORE INTO records(id,manifest,pdf) VALUES (?,?,?)",
                       (record_id, json.dumps(manifest, ensure_ascii=False), pdf))
        result["imported"] += 1
    return result
