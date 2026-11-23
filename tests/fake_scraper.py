"""A stand-in for the Go scraper's HTTP and WebSocket readings, for tests and offline UI work.

It serves tests/fixtures/snapshot.json (synthetic, test-only readings in the Go
scraper's schema) with every timestamp shifted so the reading is "now". It
never contacts Plume Labs and is not used by the real app.

    python -m tests.fake_scraper                 # http://localhost:8080/api/readings
    python -m tests.fake_scraper --mode pending  # first pass not finished yet
    python -m tests.fake_scraper --mode partial  # last pass had failures
"""

import argparse
import base64
import copy
import hashlib
import json
import math
import struct
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


def rebased_snapshot(now: float | None = None, mode: str = "ok", scenario: str = "live") -> dict:
    """The fixture with all times moved so the readings are current.

    ``scenario`` changes only the air-quality numbers, for demo rehearsal:
    ``hazy`` makes several municipalities exceed the 35 µg/m³ threshold with a
    rising PM2.5 trend; ``clear`` keeps the province clean. ``live`` leaves the
    fixture untouched.
    """
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
    return _apply_scenario(snap, scenario) if mode == "ok" else snap


def _apply_scenario(snap: dict, scenario: str) -> dict:
    """Overwrite the fixture's numbers so a hazy/clear demo repeats reliably."""
    if scenario == "live":
        return snap
    hazy = scenario == "hazy"
    for index, municipality in enumerate(snap["municipalities"]):
        base = 65 + index * 6 if hazy else 5 + index
        current_index = 90 + index * 6 if hazy else 18 + index * 2
        municipality["plume_index"] = float(current_index)
        municipality["level"] = (
            "unhealthy" if hazy and index >= 3 else "poor" if hazy else "excellent" if index < 3 else "fair"
        )
        municipality["advice"] = "Polluted. Reduce outdoor exertion." if hazy else "Air quality is good."
        pollutant = municipality.setdefault("pollutants", {}).setdefault("PM25", {"pi": 0, "value_upm": 0})
        pollutant["value_upm"] = float(base)
        pollutant["pi"] = float(base)

        forecast = municipality.get("forecast") or []
        past_hours = max(1, len(forecast) // 2)
        for hour, point in enumerate(forecast):
            # Haze builds from a cleaner 24h ago; the value at "now" (the
            # midpoint) deliberately matches the current PM2.5 reading.
            value = 12 + (base - 12) * (hour / max(1, len(forecast) - 1)) ** 2
            values = point.setdefault("values", {})
            values["PM25"] = {"pi": value, "value_upm": value}
            if hour <= past_hours:
                index_value = current_index * max(0.2, hour / past_hours)
            else:
                index_value = current_index + 5 * math.sin((hour - past_hours) / 4.0)
            point["plume_index"] = index_value
            point["plume_index_level"] = 4 if index_value >= 100 else 3 if index_value >= 50 else 2
    return snap


class _Handler(BaseHTTPRequestHandler):
    server_version = "fake-scraper"

    def do_GET(self):  # noqa: N802 (http.server naming)
        cfg = self.server.fake  # type: ignore[attr-defined]
        if self.path == "/ws/readings" and self.headers.get("Upgrade", "").lower() == "websocket":
            self._serve_websocket(cfg)
            return
        if self.path != "/api/readings":
            self.send_error(404)
            return
        if cfg["delay"]:
            time.sleep(cfg["delay"])
        if cfg["status"] != 200:
            self.send_error(cfg["status"])
            return
        body = cfg["body"] if cfg["body"] is not None else json.dumps(rebased_snapshot(mode=cfg["mode"], scenario=cfg["scenario"])).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass  # the client gave up first (timeout tests do this on purpose)

    def _serve_websocket(self, cfg):
        """Send the fake snapshot using the small server-to-browser WS subset tests need."""
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self.send_error(400)
            return
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()

        body = cfg["body"] if cfg["body"] is not None else json.dumps(rebased_snapshot(mode=cfg["mode"], scenario=cfg["scenario"])).encode()
        try:
            self.wfile.write(_websocket_frame(body))
            self.wfile.flush()
            while not cfg["stop"].wait(20):
                self.wfile.write(b"\x89\x00")  # ping; browsers reply automatically
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def log_message(self, *args):  # keep test output quiet
        pass


class FakeScraper:
    """Run the fake API on a background thread. ``port=0`` picks a free port."""

    def __init__(self, port: int = 0, mode: str = "ok", scenario: str = "live", delay: float = 0, status: int = 200, body: bytes | None = None):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        self.httpd.daemon_threads = True
        self.stop = threading.Event()
        self.httpd.fake = {"mode": mode, "scenario": scenario, "delay": delay, "status": status, "body": body, "stop": self.stop}  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop.set()
        self.httpd.shutdown()
        self.httpd.server_close()


def _websocket_frame(payload: bytes) -> bytes:
    """Encode one unmasked, final text frame (servers do not mask frames)."""
    size = len(payload)
    if size < 126:
        header = bytes((0x81, size))
    elif size <= 0xFFFF:
        header = bytes((0x81, 126)) + struct.pack("!H", size)
    else:
        header = bytes((0x81, 127)) + struct.pack("!Q", size)
    return header + payload


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--mode", choices=["ok", "pending", "partial"], default="ok")
    ap.add_argument("--scenario", choices=["live", "hazy", "clear"], default="live", help="demo numbers: hazy or clear air")
    args = ap.parse_args()
    with FakeScraper(port=args.port, mode=args.mode, scenario=args.scenario) as fake:
        print(f"fake scraper serving test fixture at {fake.url}/api/readings (mode={args.mode}, scenario={args.scenario}); Ctrl+C to stop")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
