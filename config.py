"""Settings for the Airwize Flask web app.

Every value can be overridden with an environment variable so nothing
machine-specific is committed. Change ``AIRWIZE_SCRAPER_URL`` to point Flask
at another scraper and ``AIRWIZE_WEBSOCKET_URL`` when its browser-facing
stream uses a different address.
"""

import os
from pathlib import Path


def load_env_file(path: Path | None = None) -> None:
    """Load simple ``KEY=value`` pairs from ``.env`` without extra dependencies.

    Existing shell environment variables win, so a one-off
    ``$env:AIRWIZE_AI_API_KEY=...`` still overrides the file. The file is
    intentionally git-ignored; ``.env.example`` documents the keys.
    """
    env_path = path or Path(__file__).resolve().parent / ".env"
    try:
        lines = env_path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or not key or not (key[0].isalpha() or key[0] == "_"):
            continue
        if not all(char.isalnum() or char == "_" for char in key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


load_env_file()


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

    # --- Solar/energy advisor -------------------------------------------------
    # auto: use the LLM when a key is configured, otherwise the grounded smart
    # planner. smart: never call a model. ai: require a model, fall back to the
    # planner on failure. rules: the previous rules-only behaviour.
    ADVISOR = os.environ.get("AIRWIZE_ADVISOR", "auto").strip().lower()

    # OpenAI-compatible chat-completions endpoint. The key is read here only and
    # is never included in client config or an API response.
    AI_API_KEY = os.environ.get("AIRWIZE_AI_API_KEY", "").strip()
    AI_BASE_URL = os.environ.get("AIRWIZE_AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    AI_MODEL = os.environ.get("AIRWIZE_AI_MODEL", "gpt-4o-mini").strip()
    AI_TIMEOUT = _float("AIRWIZE_AI_TIMEOUT", 8.0)
    AI_CACHE_SECONDS = _int("AIRWIZE_AI_CACHE_SECONDS", 300)

    # How often the Solar outlook asks Flask for a new forecast, in
    # milliseconds. Air-quality readings themselves arrive over the WebSocket;
    # the scraper refreshes from Plume Labs every five minutes by default.
    POLL_INTERVAL_MS = _int("AIRWIZE_POLL_INTERVAL_MS", 60_000)

    # Browser-accessible WebSocket endpoint for live readings. When omitted, it
    # is derived from SCRAPER_URL (http -> ws, https -> wss). Set this
    # explicitly when the scraper is behind a reverse proxy or uses a
    # private/internal hostname.
    WEBSOCKET_URL = os.environ.get("AIRWIZE_WEBSOCKET_URL")

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
