"""Settings for the Airwize Flask web app.

Every value can be overridden with an environment variable so nothing
machine-specific is committed. The Go scraper's address lives here and only
here: change ``AIRWIZE_SCRAPER_URL`` to point the dashboard at another scraper.
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

    # How often the browser asks for fresh readings, in milliseconds. The
    # scraper itself refreshes from Plume Labs every five minutes by default.
    POLL_INTERVAL_MS = _int("AIRWIZE_POLL_INTERVAL_MS", 60_000)

    # Where `python web.py` listens.
    HOST = os.environ.get("AIRWIZE_HOST", "127.0.0.1")
    PORT = _int("AIRWIZE_PORT", 5000)
