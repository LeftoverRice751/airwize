"""Settings for the Airwize Flask web app.

Every value can be overridden with an environment variable so nothing
machine-specific is committed. Change ``AIRWIZE_SCRAPER_URL`` to point Flask
at another scraper and ``AIRWIZE_WEBSOCKET_URL`` when its browser-facing
stream uses a different address.
"""

import os


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


class Config:
    # Base URL of the Go scraper started with `go run . -serve :8080`.
    SCRAPER_URL = os.environ.get("AIRWIZE_SCRAPER_URL", "http://localhost:8080").rstrip("/")

    # Seconds Flask waits for the scraper before reporting it unavailable.
    SCRAPER_TIMEOUT = _float("AIRWIZE_SCRAPER_TIMEOUT", 5.0)

    # Browser-accessible WebSocket endpoint. When omitted, it is derived from
    # SCRAPER_URL (http -> ws, https -> wss). Set this explicitly when the
    # scraper is behind a reverse proxy or uses a private/internal hostname.
    WEBSOCKET_URL = os.environ.get("AIRWIZE_WEBSOCKET_URL")

    # Energy tab, live mode. Name of the solar Wi-Fi module adapter registered
    # in webapp/services/energy_device.py (none ships yet, so live mode reports
    # "not configured"), the module's address on the local network, and how
    # long to wait for it. See README.md, "Energy tab".
    ENERGY_DEVICE_ADAPTER = os.environ.get("AIRWIZE_ENERGY_ADAPTER", "").strip()
    ENERGY_DEVICE_ADDRESS = os.environ.get("AIRWIZE_ENERGY_DEVICE_ADDRESS", "").strip()
    ENERGY_DEVICE_TIMEOUT = _float("AIRWIZE_ENERGY_DEVICE_TIMEOUT", 3.0)

    # How often the browser asks Flask for a live device reading.
    ENERGY_POLL_INTERVAL_MS = _int("AIRWIZE_ENERGY_POLL_INTERVAL_MS", 10_000)

    # Energy optimization suggestions (future AI integration). Name of the
    # provider registered in webapp/services/energy_optimization.py; empty
    # keeps the Energy tab's suggestions area an empty placeholder.
    ENERGY_OPTIMIZER = os.environ.get("AIRWIZE_ENERGY_OPTIMIZER", "").strip()

    # Where `python web.py` listens.
    HOST = os.environ.get("AIRWIZE_HOST", "127.0.0.1")
    PORT = _int("AIRWIZE_PORT", 5000)
