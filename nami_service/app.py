import datetime
import hashlib
import hmac
import io
import json
import os
import secrets
import threading
import time
import uuid
from contextlib import closing
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, Request, abort, jsonify, request, send_file, session
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash

from .catalog import load_catalog
from .documents import make_document
from .scanning import process_scan
from .storage import connect, initialize, load_manifests, private_root, transaction, write_private


PREFIX = "/api/nami"
MAX_UPLOAD = 20 * 1024 * 1024
PERMISSIONS = {
    "operator": {"read", "create", "confirm"},
    "registrar": {"read", "create"},
    "reviewer": {"read", "confirm"},
}


class PrivateRequest(Request):
    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        # The bounded request stays in memory; Werkzeug must not spool personal files to /tmp.
        return io.BytesIO()


def create_app(config=None):
    options = dict(os.environ)
    options.update(config or {})
    root = private_root(options.get("NAMI_DATA_DIR"), options.get("NAMI_PUBLIC_ROOT"))
    secret = options.get("NAMI_SECRET_KEY", "")
    username = options.get("NAMI_USERNAME", "")
    password_hash = options.get("NAMI_PASSWORD_HASH", "")
    origin = options.get("NAMI_ORIGIN", "").rstrip("/")
    role = options.get("NAMI_ROLE", "operator")
    parts = urlsplit(origin)
    if len(secret) < 32 or not username or len(username) > 100:
        raise ValueError("Configure a strong NAMI_SECRET_KEY and NAMI_USERNAME")
    if not password_hash.startswith(("scrypt:", "pbkdf2:")):
        raise ValueError("NAMI_PASSWORD_HASH must be a Werkzeug password hash")
    if (parts.scheme not in {"http", "https"} or not parts.netloc or parts.path or
            parts.query or parts.fragment or parts.username or parts.password):
        raise ValueError("NAMI_ORIGIN must be the exact browser origin")
    if parts.scheme != "https" and parts.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("HTTPS is required except for localhost")
    if role not in PERMISSIONS:
        raise ValueError("Invalid NAMI_ROLE")
    tarja = Path(options.get("NAMI_TARJA_PATH", ""))
    repository = Path(__file__).resolve().parent.parent
    forbidden = [repository]
    if options.get("NAMI_PUBLIC_ROOT"):
        forbidden.append(Path(options["NAMI_PUBLIC_ROOT"]).resolve())
    if any(parent == tarja.resolve() or parent in tarja.resolve().parents for parent in forbidden):
        raise ValueError("TARJA cannot be in the repository or public root")
    if any(part.lower() in {"static", "public", "www", "wwwroot", "htdocs"} for part in tarja.resolve().parts):
        raise ValueError("TARJA cannot be in a publication directory")
    catalog = load_catalog(root, str(tarja), options.get("NAMI_TARJA_SHEET", "TARJA"))
    initialize(root)
    with closing(connect(root)) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS login_failures (
            address TEXT NOT NULL, occurred REAL NOT NULL
        )""")
    app = Flask(__name__, static_folder=None)
    app.request_class = PrivateRequest
    app.config.update(
        SECRET_KEY=secret, MAX_CONTENT_LENGTH=MAX_UPLOAD,
        MAX_FORM_MEMORY_SIZE=64 * 1024, MAX_FORM_PARTS=4,
        SESSION_COOKIE_NAME="__Host-nami", SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True, SESSION_COOKIE_SAMESITE="Strict",
        SESSION_COOKIE_PATH="/", PERMANENT_SESSION_LIFETIME=datetime.timedelta(hours=8),
        SESSION_REFRESH_EACH_REQUEST=False,
    )
    app.extensions["nami_root"] = root
    app.extensions["nami_catalog"] = catalog
    scan_lock = threading.BoundedSemaphore(1)

    def authenticated():
        return session.get("username") == username and session.get("role") == role

    def protected(permission):
        def decorate(function):
            @wraps(function)
            def wrapped(*args, **kwargs):
                if not authenticated():
                    abort(401)
                if permission not in PERMISSIONS[session["role"]]:
                    abort(403)
                return function(*args, **kwargs)
            return wrapped
        return decorate

    @app.before_request
    def bounds_and_csrf():
        if len(request.path) > 512 or len(request.query_string) > 2048:
            abort(400)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.headers.get("Origin") != origin:
                abort(403)
            fetch_site = request.headers.get("Sec-Fetch-Site")
            if fetch_site and fetch_site != "same-origin":
                abort(403)
            # Login is protected by mandatory exact Origin validation before any credential handling.
            # Authenticated mutations additionally require the token issued on successful login.
            if request.path != PREFIX + "/login":
                expected = session.get("csrf", "")
                supplied = request.headers.get("X-CSRF-Token", "")
                if not expected or not hmac.compare_digest(expected.encode(), supplied.encode()):
                    abort(403)
            if request.mimetype == "application/json" and (
                    request.content_length is None or request.content_length > 128 * 1024):
                abort(413)

    @app.after_request
    def security_headers(response):
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        return response

    @app.errorhandler(Exception)
    def generic_error(error):
        status = error.code if isinstance(error, HTTPException) else 500
        return jsonify(error="Solicitud no válida o no autorizada" if status < 500
                       else "No fue posible procesar la solicitud"), status

    def body():
        if request.mimetype != "application/json":
            abort(415)
        value = request.get_json()
        if not isinstance(value, dict):
            abort(400)
        return value

    @app.get(PREFIX + "/session")
    def get_session():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(32)
        return jsonify(authenticated=authenticated(), csrf=session["csrf"])

    @app.post(PREFIX + "/login")
    def login():
        value = body()
        supplied_user = value.get("username", "")
        password = value.get("password", "")
        if not isinstance(supplied_user, str) or not isinstance(password, str) or len(password) > 256 or len(supplied_user) > 100:
            abort(400)
        address = request.remote_addr or "unknown"
        now = time.time()
        # Reserve an attempt atomically before expensive hashing to bound parallel attempts.
        with transaction(root) as db:
            db.execute("DELETE FROM login_failures WHERE occurred < ?", (now - 300,))
            attempts = db.execute("SELECT COUNT(*) FROM login_failures WHERE address=?", (address,)).fetchone()[0]
            if attempts >= 10:
                abort(429)
            db.execute("INSERT INTO login_failures VALUES (?,?)", (address, now))
        password_ok = check_password_hash(password_hash, password)
        user_ok = hmac.compare_digest(supplied_user.encode(), username.encode())
        if not (password_ok and user_ok):
            abort(401)
        session.clear()
        session.permanent = True
        session.update(username=username, role=role, csrf=secrets.token_urlsafe(32))
        return jsonify(authenticated=True, csrf=session["csrf"])

    @app.post(PREFIX + "/logout")
    @protected("read")
    def logout():
        session.clear()
        return jsonify(authenticated=False)

    @app.get(PREFIX + "/catalog")
    @protected("read")
    def get_catalog():
        return jsonify(catalog)

    @app.post(PREFIX + "/records")
    @protected("create")
    def records():
        value = body()
        if value.get("format_accepted") is not True:
            abort(400)
        crew_id = value.get("crew_id")
        if not isinstance(crew_id, (str, int)) or isinstance(crew_id, bool):
            abort(400)
        crew = next((item for item in catalog["crews"] if item["id"] == str(crew_id)), None)
        selection = value.get("courses")
        if not crew or not isinstance(selection, list) or not 1 <= len(selection) <= 4:
            abort(400)
        if any(not isinstance(item, str) for item in selection) or len(set(selection)) != len(selection):
            abort(400)
        courses = []
        for course_id in selection:
            course = next((item for item in catalog["courses"] if item["id"] == course_id), None)
            if not course:
                abort(400)
            courses.append(dict(course))
        date = value.get("date")
        try:
            if not isinstance(date, str) or datetime.date.fromisoformat(date).isoformat() != date:
                abort(400)
        except ValueError:
            abort(400)
        try:
            manifest, pdf = make_document(crew, courses, date, secret)
        except ValueError:
            abort(400)
        if len(manifest["pages"]) > 25:
            abort(400)
        path = root / "records" / f'{manifest["id"]}.pdf'
        write_private(path, pdf)
        try:
            with transaction(root) as db:
                db.execute("INSERT INTO records(id,manifest,pdf) VALUES (?,?,?)",
                           (manifest["id"], json.dumps(manifest, ensure_ascii=False), path.name))
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return jsonify(id=manifest["id"], pages=len(manifest["pages"]),
                       participants=manifest["participants"], courses=courses,
                       pdf_url=f'{PREFIX}/records/{manifest["id"]}/pdf'), 201

    def find(table, identifier):
        try:
            uuid.UUID(identifier)
        except ValueError:
            abort(404)
        db = connect(root)
        try:
            row = db.execute(f"SELECT * FROM {table} WHERE id=?", (identifier,)).fetchone()
        finally:
            db.close()
        if not row:
            abort(404)
        return row

    @app.get(PREFIX + "/records/<identifier>/pdf")
    @protected("read")
    def record_pdf(identifier):
        row = find("records", identifier)
        return send_file(root / "records" / row["pdf"], mimetype="application/pdf",
                         as_attachment=True, download_name=f"nami-{identifier}.pdf", conditional=False)

    @app.post(PREFIX + "/scans")
    @protected("confirm")
    def scans():
        if not scan_lock.acquire(blocking=False):
            abort(429)
        scan_id, path = None, None
        try:
            if request.mimetype != "multipart/form-data" or len(request.files) != 1 or "file" not in request.files:
                abort(400)
            upload = request.files["file"]
            data = upload.stream.read(MAX_UPLOAD + 1)
            if not data or len(data) > MAX_UPLOAD or not data.startswith(b"%PDF-"):
                abort(400)
            digest = hashlib.sha256(data).hexdigest()
            db = connect(root)
            try:
                previous = db.execute("SELECT * FROM scans WHERE sha256=?", (digest,)).fetchone()
            finally:
                db.close()
            if previous:
                return jsonify(id=previous["id"], duplicate=True, pages=json.loads(previous["pages"]))
            scan_id = str(uuid.uuid4())
            path = root / "scans" / f"{scan_id}.pdf"
            write_private(path, data)
            try:
                pages = process_scan(root, scan_id, path, load_manifests(root), secret)
            except ValueError:
                abort(422)
            with transaction(root) as db:
                # Another process may have completed the same hash in the meantime.
                previous = db.execute("SELECT * FROM scans WHERE sha256=?", (digest,)).fetchone()
                if previous:
                    path.unlink(missing_ok=True)
                    for image in (root / "rows").glob(f"{scan_id}-*.png"):
                        image.unlink()
                    return jsonify(id=previous["id"], duplicate=True, pages=json.loads(previous["pages"]))
                db.execute("INSERT INTO scans(id,sha256,pdf,pages) VALUES (?,?,?,?)",
                           (scan_id, digest, path.name, json.dumps(pages, ensure_ascii=False)))
            return jsonify(id=scan_id, duplicate=False, pages=pages), 201
        except BaseException:
            if path:
                path.unlink(missing_ok=True)
            if scan_id:
                for image in (root / "rows").glob(f"{scan_id}-*.png"):
                    image.unlink()
                (root / "scans" / f"{scan_id}.json").unlink(missing_ok=True)
            raise
        finally:
            scan_lock.release()

    @app.get(PREFIX + "/scans/<identifier>/rows/<row_id>/image")
    @protected("read")
    def row_image(identifier, row_id):
        scan = find("scans", identifier)
        ids = {row["id"] for page in json.loads(scan["pages"]) for row in page["rows"]}
        if row_id not in ids:
            abort(404)
        return send_file(root / "rows" / f"{row_id}.png", mimetype="image/png", conditional=False)

    @app.get(PREFIX + "/scans/<identifier>/pdf")
    @protected("read")
    def evidence_pdf(identifier):
        scan = find("scans", identifier)
        return send_file(root / "scans" / scan["pdf"], mimetype="application/pdf",
                         as_attachment=True, download_name=f"evidence-{identifier}.pdf", conditional=False)

    def result_rows(db, scan_id=None):
        sql = "SELECT rut,course_id,status,record_id,scan_id,confirmed_by,created_at FROM results"
        values = ()
        if scan_id:
            sql += " WHERE scan_id=?"
            values = (scan_id,)
        sql += " ORDER BY id"
        return [{**dict(row), "evidence_url": f'{PREFIX}/scans/{row["scan_id"]}/pdf'}
                for row in db.execute(sql, values)]

    @app.post(PREFIX + "/scans/<identifier>/confirm")
    @protected("confirm")
    def confirm(identifier):
        value = body()
        decisions = value.get("decisions")
        if not isinstance(decisions, list) or not 1 <= len(decisions) <= 500:
            abort(400)
        mapping = {}
        for decision in decisions:
            if (not isinstance(decision, dict) or set(decision) != {"row_id", "status"} or
                    not isinstance(decision["row_id"], str) or not isinstance(decision["status"], str) or
                    decision["status"] not in {"FIRMO", "NO_FIRMO"} or
                    decision["row_id"] in mapping):
                abort(400)
            mapping[decision["row_id"]] = decision["status"]
        canonical = json.dumps(mapping, sort_keys=True)
        find("scans", identifier)
        with transaction(root) as db:
            scan = db.execute("SELECT * FROM scans WHERE id=?", (identifier,)).fetchone()
            pages = json.loads(scan["pages"])
            if any(page["record_id"] is None for page in pages):
                abort(409)
            rows = {row["id"]: (page["record_id"], row) for page in pages for row in page["rows"]}
            if set(mapping) != set(rows):
                abort(400)
            if scan["confirmed"]:
                if scan["decisions"] != canonical:
                    abort(409)
                return jsonify(confirmed=True, duplicate=True, results=result_rows(db, identifier))
            manifests = {record_id: json.loads(db.execute(
                "SELECT manifest FROM records WHERE id=?", (record_id,)).fetchone()[0])
                for record_id, _ in rows.values()}
            for row_id, status in mapping.items():
                record_id, row = rows[row_id]
                for course in manifests[record_id]["courses"]:
                    db.execute("""INSERT INTO results(scan_id,row_id,record_id,rut,course_id,status,confirmed_by)
                                  VALUES (?,?,?,?,?,?,?)""",
                               (identifier, row_id, record_id, row["rut"], course["id"], status, username))
            db.execute("UPDATE scans SET confirmed=1,decisions=? WHERE id=?", (canonical, identifier))
            return jsonify(confirmed=True, duplicate=False, results=result_rows(db, identifier))

    @app.get(PREFIX + "/results")
    @protected("read")
    def results():
        db = connect(root)
        try:
            return jsonify(results=result_rows(db))
        finally:
            db.close()

    return app
