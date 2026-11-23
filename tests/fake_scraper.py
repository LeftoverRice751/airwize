"""A stand-in for the Go scraper's ``GET /api/readings``, for tests and offline UI work.

It serves tests/fixtures/snapshot.json (synthetic, test-only readings in the Go
scraper's schema) with every timestamp shifted so the reading is "now". It
never contacts Plume Labs and is not used by the real app.

    python -m tests.fake_scraper                 # http://localhost:8080/api/readings
    python -m tests.fake_scraper --mode pending  # first pass not finished yet
    python -m tests.fake_scraper --mode partial  # last pass had failures
"""

import argparse
import copy
import json
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "snapshot.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(iso: str) -> float:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def rebased_snapshot(now: float | None = None, mode: str = "ok") -> dict:
    """The fixture with all times moved so the readings are current."""
    snap = copy.deepcopy(load_fixture())
    now = time.time() if now is None else now
    hour = now - now % 3600
    shift = hour - _parse(snap["municipalities"][0]["measured_at"])
    for m in snap["municipalities"]:
        m["measured_at"] = _iso(_parse(m["measured_at"]) + shift)
        m["fetched_at"] = _iso(now)
        for p in m["forecast"] or []:
            p["timestamp"] = int(p["timestamp"] + shift)
    snap["updated_at"] = _iso(now)
    if mode == "pending":
        snap["updated_at"] = None
        snap["municipalities"] = []
    elif mode == "partial":
        snap["error"] = 'GET https://air.plumelabs.com/air-quality-in-Example: status 503'
    return snap


class _Handler(BaseHTTPRequestHandler):
    server_version = "fake-scraper"

    def do_GET(self):  # noqa: N802 (http.server naming)
        cfg = self.server.fake  # type: ignore[attr-defined]
        if self.path != "/api/readings":
            self.send_error(404)
            return
        if cfg["delay"]:
            time.sleep(cfg["delay"])
        if cfg["status"] != 200:
            self.send_error(cfg["status"])
            return
        body = cfg["body"] if cfg["body"] is not None else json.dumps(rebased_snapshot(mode=cfg["mode"])).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the client gave up first (timeout tests do this on purpose)

    def log_message(self, *args):  # keep test output quiet
        pass


class FakeScraper:
    """Run the fake API on a background thread. ``port=0`` picks a free port."""

    def __init__(self, port: int = 0, mode: str = "ok", delay: float = 0, status: int = 200, body: bytes | None = None):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        self.httpd.daemon_threads = True
        self.httpd.fake = {"mode": mode, "delay": delay, "status": status, "body": body}  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--mode", choices=["ok", "pending", "partial"], default="ok")
    args = ap.parse_args()
    with FakeScraper(port=args.port, mode=args.mode) as fake:
        print(f"fake scraper serving test fixture at {fake.url}/api/readings (mode={args.mode}); Ctrl+C to stop")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
