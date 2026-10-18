"""Tiny static server for the frontend that tells the browser NOT to cache files,
so you never get a stale js/app.js after updating the project.
Run:  python serve.py      then open http://localhost:8000
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    """A normal file server that also tells the browser not to keep old copies of the files."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving frontend on http://localhost:{port}  (no-cache)  - Ctrl+C to stop")
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
