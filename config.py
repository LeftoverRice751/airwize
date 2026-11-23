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

    # Energy tab suggestions. Name of a provider registered in
    # webapp/services/energy_optimization.py: "rules" shows the Solar outlook's
    # rules-based recommendations; set it empty to show an empty placeholder.
    ENERGY_OPTIMIZER = os.environ.get("AIRWIZE_ENERGY_OPTIMIZER", "rules").strip()

    # How often the Solar outlook asks Flask for a new forecast, in
    # milliseconds. Air-quality readings themselves arrive over the WebSocket;
    # the scraper refreshes from Plume Labs every five minutes by default.
    POLL_INTERVAL_MS = _int("AIRWIZE_POLL_INTERVAL_MS", 60_000)

    # --- Synthetic solar outlook (demo data, clearly labelled in the UI) ---

    # Name of the imaginary rooftop array. Only used for display and for
    # seeding the deterministic cloudiness sequence.
    AIRWIZE_SOLAR_SITE_NAME = os.environ.get("AIRWIZE_SOLAR_SITE_NAME", "demo-laguna-site")

    # Nameplate capacity in kW. Peak synthetic generation at noon on a clear,
    # clean day equals this value.
    AIRWIZE_SOLAR_PEAK_KW = _float("AIRWIZE_SOLAR_PEAK_KW", 5.0)

    # Pollution attenuation coefficient: factor = clamp(1 - k * PM2.5, 0.6, 1.0).
    # The default loses about 7 % of output at 35 µg/m³ and hits the 40 % floor
    # around 200 µg/m³.
    AIRWIZE_POLLUTION_ATTENUATION_K = _float("AIRWIZE_POLLUTION_ATTENUATION_K", 0.002)

    # PM2.5 thresholds in µg/m³ used by the rules-based recommendations.
    AIRWIZE_PM25_HIGH = _float("AIRWIZE_PM25_HIGH", 35.0)
    AIRWIZE_PM25_CRITICAL = _float("AIRWIZE_PM25_CRITICAL", 75.0)

    # Where `python app.py` listens.
    HOST = os.environ.get("AIRWIZE_HOST", "127.0.0.1")
    PORT = _int("AIRWIZE_PORT", 5000)
