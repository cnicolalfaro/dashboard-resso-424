import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def private_root(value):
    if not value or not Path(value).is_absolute():
        raise ValueError("NAMI_DATA_DIR must be an absolute external private directory")
    root = Path(value).resolve()
    repository = Path(__file__).resolve().parent.parent
    public = os.environ.get("NAMI_PUBLIC_ROOT")
    forbidden = [repository]
    if public:
        if not Path(public).is_absolute():
            raise ValueError("NAMI_PUBLIC_ROOT must be absolute")
        forbidden.append(Path(public).resolve())
    if any(root == p or p in root.parents or root in p.parents for p in forbidden):
        raise ValueError("Private storage must be separate from the repository/public root")
    if any(part.lower() in {"static", "public", "www", "wwwroot", "htdocs"} for part in root.parts):
        raise ValueError("Private storage cannot be in a publication directory")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.stat().st_mode & 0o077:
        raise ValueError("NAMI_DATA_DIR must have permissions 0700")
    for name in ("records", "scans", "rows"):
        (root / name).mkdir(mode=0o700, exist_ok=True)
        if (root / name).is_symlink() or (root / name).resolve().parent != root:
            raise ValueError("Storage subdirectories cannot be symlinks")
        os.chmod(root / name, 0o700)
    return root


def connect(root):
    db = sqlite3.connect(root / "nami.sqlite3", timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    return db


def initialize(root):
    with connect(root) as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY, manifest TEXT NOT NULL, pdf TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS immutable_records_update BEFORE UPDATE ON records
        BEGIN SELECT RAISE(ABORT, 'immutable manifest'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_records_delete BEFORE DELETE ON records
        BEGIN SELECT RAISE(ABORT, 'immutable manifest'); END;
        CREATE TABLE IF NOT EXISTS scans (
            id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, pdf TEXT NOT NULL,
            pages TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
            decisions TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id),
            row_id TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES records(id),
            rut TEXT NOT NULL, course_id TEXT NOT NULL, status TEXT NOT NULL,
            confirmed_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(scan_id,row_id,course_id),
            CHECK(status IN ('FIRMO','NO_FIRMO'))
        );
        """)
    os.chmod(root / "nami.sqlite3", 0o600)


@contextmanager
def transaction(root):
    db = connect(root)
    try:
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.execute("COMMIT")
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()


def write_private(path, data):
    # O_EXCL avoids overwriting evidence and follows no existing symlinks.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def load_manifests(root):
    db = connect(root)
    try:
        return {row["id"]: json.loads(row["manifest"]) for row in db.execute(
            "SELECT id,manifest FROM records"
        )}
    finally:
        db.close()
