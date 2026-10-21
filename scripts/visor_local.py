"""Servidor local para ver en el Modo Auditor los archivos de la carpeta
RESSO sincronizada con SharePoint. Solo escucha en 127.0.0.1.

Uso:  python scripts/visor_local.py
"""
import json
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.environ.get(
    "RESSO_LOCAL_ROOT",
    r"C:\Users\cnico\OneDrive - Empresas SK\Shortcuts\SKCIC - ICSK HSEC - 0.- RESSO Ver. 10\02 RESSO V10",
)
PORT = 8765
INLINE_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".svg"}
MAX_UPLOAD = 100 * 1024 * 1024
BLOCKED_EXT = {".exe", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".msi", ".scr", ".lnk", ".com", ".hta"}


def origin_allowed(origin):
    try:
        u = urlparse(origin)
    except ValueError:
        return False
    return u.scheme in ("http", "https") and u.hostname in ("localhost", "127.0.0.1")


def resolve(rel):
    full = os.path.realpath(os.path.join(ROOT, rel.replace("/", os.sep)))
    root = os.path.realpath(ROOT)
    if full != root and not full.startswith(root + os.sep):
        return None
    return full if os.path.isfile(full) else None


def question_folder(phase, section, qid):
    """Devuelve la carpeta existente 'Pregunta N' (con o sin cero a la izquierda)."""
    base = os.path.realpath(os.path.join(ROOT, phase, section))
    root = os.path.realpath(ROOT)
    if not base.startswith(root + os.sep) or not os.path.isdir(base):
        return None
    for name in os.listdir(base):
        m = re.fullmatch(r"Pregunta\s+0*(\d+)", name.strip(), re.I)
        if m and int(m.group(1)) == qid and os.path.isdir(os.path.join(base, name)):
            return os.path.join(base, name)
    return None


def unique_path(folder, name):
    stem, ext = os.path.splitext(name)
    path, n = os.path.join(folder, name), 1
    while os.path.exists(path):
        path = os.path.join(folder, f"{stem} ({n}){ext}")
        n += 1
    return path


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", extra=None):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/upload":
            return self._send(404, b"no encontrado")
        if not origin_allowed(self.headers.get("Origin", "")):
            return self._send(403, b"origen no permitido")

        q = parse_qs(url.query)
        try:
            qid = int(q["q"][0])
            phase, section = q["phase"][0], q["section"][0]
            name = os.path.basename(q["name"][0].replace("\\", "/")).strip()
            length = int(self.headers.get("Content-Length", "0"))
        except (KeyError, ValueError, IndexError):
            return self._send(400, b"parametros invalidos")

        if not name or os.path.splitext(name)[1].lower() in BLOCKED_EXT:
            return self._send(400, b"nombre o tipo de archivo no permitido")
        if length <= 0 or length > MAX_UPLOAD:
            return self._send(413, b"archivo vacio o mayor a 100 MB")

        folder = question_folder(phase, section, qid)
        if not folder:
            return self._send(404, b"no existe la carpeta del requisito")

        dest = unique_path(folder, name)
        remaining = length
        with open(dest, "wb") as fh:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                fh.write(chunk)
                remaining -= len(chunk)

        rel = os.path.relpath(dest, os.path.realpath(ROOT)).replace(os.sep, "/")
        body = json.dumps({"path": rel, "name": os.path.basename(dest)}).encode()
        self._send(200, body, "application/json; charset=utf-8")

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/ping":
            return self._send(200, b"ok")

        if url.path.startswith("/file/") or url.path.startswith("/open/"):
            action, rel = url.path[1:].split("/", 1)
            full = resolve(unquote(rel))
            if not full:
                return self._send(404, "Archivo no encontrado".encode())

            if action == "open":
                if not origin_allowed(self.headers.get("Origin", "")):
                    return self._send(403, b"origen no permitido")
                os.startfile(full)
                return self._send(200, b"abierto")

            ext = os.path.splitext(full)[1].lower()
            if ext not in INLINE_EXT:
                return self._send(415, b"Tipo no visible en navegador")
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as fh:
                data = fh.read()
            return self._send(200, data, ctype, {"Content-Disposition": "inline"})

        self._send(404, b"no encontrado")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    if not os.path.isdir(ROOT):
        sys.exit(f"No existe la carpeta sincronizada:\n{ROOT}")
    print(f"Visor local activo en http://127.0.0.1:{PORT}  (Ctrl+C para detener)")
    print(f"Carpeta: {ROOT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
