import os
import tempfile

from waitress import serve

from .app import create_app


if __name__ == "__main__":
    app = create_app()
    tempfile.tempdir = str(app.extensions["nami_root"])
    serve(app, host="127.0.0.1", port=int(os.environ.get("NAMI_PORT", "8001")),
          threads=4, max_request_body_size=20 * 1024 * 1024,
          inbuf_overflow=21 * 1024 * 1024, outbuf_overflow=64 * 1024 * 1024,
          max_request_header_size=16384, channel_timeout=60,
          expose_tracebacks=False)
