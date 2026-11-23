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

    # Where `python web.py` listens.
    HOST = os.environ.get("AIRWIZE_HOST", "127.0.0.1")
    PORT = _int("AIRWIZE_PORT", 5000)
