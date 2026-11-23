"""Synthetic solar generation for the Airwize demo.

There is no inverter behind this module. It turns the *real* PM2.5 readings and
forecasts scraped by the Go service into an imaginary rooftop array's output, so
the dashboard can show a weather-only forecast beside an AQI-aware one. Every
row it produces is marked ``"synthetic": True`` and the UI labels it.

The model is deliberately small and deterministic:

* irradiance follows a half sine between 06:00 and 18:00 Manila time, peaking
  at noon (Manila has no daylight saving, so a fixed +08:00 offset is exact);
* cloudiness is a seeded pseudo-random value per site and hour, so a demo
  replays identically;
* PM2.5 attenuates output by ``clamp(1 - k * pm25, 0.6, 1.0)``.

Limitations are intentional and documented in ``docs/mvp-plan.md``: this is a
hackathon demo signal, not a validated photovoltaic model.
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from config import Config

# The Philippines has no daylight saving time, so a fixed offset avoids a
# dependency on the IANA tz database (which Windows Python often lacks).
MANILA = timezone(timedelta(hours=8), "Asia/Manila")
UTC = timezone.utc

SUNRISE_HOUR = 6.0
SUNSET_HOUR = 18.0
CLOUD_ATTENUATION = 0.65  # fraction of output lost at fully overcast skies
POLLUTION_FLOOR = 0.6  # never attenuate more than 40 % for pollution alone
POLLUTION_CEILING = 1.0
MAX_CLOUDINESS = 0.85  # keep a little direct sun even on the cloudiest demo hour


def setting(name: str, default: Any = None) -> Any:
    """Read a setting from the running Flask app, falling back to ``Config``.

    Functions in this module are used both from requests (where the app config
    may be overridden by tests) and directly from unit tests (no app context).
    """
    try:
        from flask import current_app

        value = current_app.config.get(name)
        if value is not None:
            return value
    except RuntimeError:
        pass
    return getattr(Config, name, default)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def as_datetime(value: Any) -> datetime | None:
    """Parse the scraper's RFC 3339 strings (and Unix seconds) into aware UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value, UTC)
    else:
        text = str(value).strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def iso_z(dt: datetime) -> str:
    """RFC 3339 UTC with seconds, matching the Go scraper's timestamp style."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def observed_at(snapshot: dict, now: Any = None) -> datetime:
    """The time the snapshot describes: ``updated_at``, else a measurement.

    Tests (and the API, for consistency) can pass an explicit ``now``.
    """
    if now is not None:
        parsed = as_datetime(now)
        if parsed is not None:
            return parsed
    parsed = as_datetime(snapshot.get("updated_at"))
    if parsed is not None:
        return parsed
    for municipality in snapshot.get("municipalities") or []:
        if not isinstance(municipality, dict):
            continue
        parsed = as_datetime(municipality.get("measured_at"))
        if parsed is not None:
            return parsed
    return datetime.now(UTC)


def solar_elevation(ts: Any) -> float:
    """Half-sine elevation in [0, 1]; zero before 06:00 and after 18:00.

    Exactly 06:00 and 18:00 are zero, matching "zero before 06:00 and after
    18:00" while avoiding a discontinuity at the edges.
    """
    dt = as_datetime(ts)
    if dt is None:
        return 0.0
    local = dt.astimezone(MANILA)
    hour = local.hour + local.minute / 60 + local.second / 3600
    if hour <= SUNRISE_HOUR or hour >= SUNSET_HOUR:
        return 0.0
    return math.sin(math.pi * (hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR))


def peak_kw() -> float:
    return float(setting("AIRWIZE_SOLAR_PEAK_KW", 5.0))


def pollution_factor(pm25: float | None) -> float:
    """PM2.5 attenuation, clamped so pollution alone cannot wipe out the array."""
    k = float(setting("AIRWIZE_POLLUTION_ATTENUATION_K", 0.002))
    concentration = 0.0 if pm25 is None else max(0.0, float(pm25))
    return _clamp(1.0 - k * concentration, POLLUTION_FLOOR, POLLUTION_CEILING)


def synthetic_generation(ts: Any, cloudiness: float, pm25: float | None) -> float:
    """Synthetic AC output in kW for one timestamp, cloudiness and PM2.5."""
    elevation = solar_elevation(ts)
    if elevation <= 0.0:
        return 0.0
    cloud = _clamp(0.0 if cloudiness is None else float(cloudiness), 0.0, 1.0)
    cloud_factor = 1.0 - CLOUD_ATTENUATION * cloud
    return round(peak_kw() * elevation * cloud_factor * pollution_factor(pm25), 3)


def cloudiness_for(ts: Any, site: str | None = None) -> float:
    """Deterministic pseudo-random cloudiness in [0, 0.85] for a site and hour."""
    dt = as_datetime(ts)
    if dt is None:
        return 0.0
    site = site or str(setting("AIRWIZE_SOLAR_SITE_NAME", "demo-laguna-site"))
    key = f"{site}:{dt.astimezone(MANILA):%Y-%m-%dT%H}"
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    unit = int.from_bytes(digest[:8], "big") / 2**64
    # Raise to a power > 1 so clear hours are more common than overcast ones.
    return round(MAX_CLOUDINESS * unit**1.6, 3)


def municipality_pm25(municipality: dict) -> float | None:
    """Real PM2.5 concentration in µg/m³ from ``pollutants.PM25.value_upm``.

    Plume's ``pi`` is a sub-index, not a concentration, so it is deliberately
    not used as a fallback.
    """
    pollutants = municipality.get("pollutants") or {}
    pm25 = pollutants.get("PM25") or {}
    value = pm25.get("value_upm")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def focus_municipality(snapshot: dict) -> dict | None:
    """The municipality the demo array lives in.

    The single synthetic site is attached to the worst current PM2.5 reading,
    which makes the haze-versus-solar story visible; ties are broken by city
    name so repeated calls on the same snapshot agree.
    """
    municipalities = [m for m in snapshot.get("municipalities") or [] if isinstance(m, dict) and m.get("city")]
    if not municipalities:
        return None

    def rank(municipality: dict) -> tuple[float, str]:
        pm25 = municipality_pm25(municipality)
        return (-(pm25 if pm25 is not None else -1.0), str(municipality["city"]))

    return min(municipalities, key=rank)


def pm25_series(snapshot: dict, municipality: dict) -> list[tuple[int, float]]:
    """Hourly PM2.5 values from the snapshot's measured and forecast points.

    Keys are Unix seconds. The Go scraper's forecast covers roughly 24 hours
    back and 24 hours ahead, giving the AQI model a real, varying pollution
    signal instead of a constant.
    """
    values: dict[int, float] = {}
    for point in municipality.get("forecast") or []:
        if not isinstance(point, dict):
            continue
        dt = as_datetime(point.get("timestamp"))
        pm25 = municipality_pm25({"pollutants": point.get("values") or {}})
        if dt is None or pm25 is None:
            continue
        values[int(dt.timestamp())] = pm25

    measured = as_datetime(municipality.get("measured_at"))
    current = municipality_pm25(municipality)
    if measured is not None and current is not None:
        values[int(measured.timestamp())] = current

    return sorted(values.items())


def pm25_lookup(
    series: list[tuple[int, float]],
    ts: Any,
    fallback: float | None = None,
    max_gap: timedelta = timedelta(hours=2),
) -> float | None:
    """Nearest PM2.5 value within ``max_gap``; otherwise ``fallback``.

    The gap guard stops the last forecast hour being smeared across a 48-hour
    synthetic history.
    """
    if not series:
        return fallback
    dt = as_datetime(ts)
    if dt is None:
        return fallback
    target = int(dt.timestamp())
    nearest_ts, nearest_value = min(series, key=lambda item: abs(int(item[0]) - target))
    if abs(int(nearest_ts) - target) > max_gap.total_seconds():
        return fallback
    return nearest_value


def build_paired_dataset(snapshot: dict, hours: int = 48, now: Any = None) -> list[dict]:
    """Hourly rows pairing real PM2.5 with synthetic generation.

    Each row is ``{timestamp, municipality, pm25, cloudiness, generation_kw,
    synthetic}``. The timeline ends at the observation hour and runs backwards
    for ``hours`` rows, so the newest row is the current hour.
    """
    if hours < 1:
        raise ValueError("hours must be at least 1")
    focus = focus_municipality(snapshot)
    if focus is None:
        raise ValueError("the snapshot contains no municipalities")

    end = observed_at(snapshot, now).astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    series = pm25_series(snapshot, focus)
    # Hours older than the forecast window are extrapolated from the oldest
    # value we have (the start of the forecast series), not from today's
    # reading: a hazy afternoon should not rewrite yesterday's history.
    fallback = series[0][1] if series else municipality_pm25(focus)
    rows: list[dict] = []
    for step in range(hours - 1, -1, -1):
        ts = end - timedelta(hours=step)
        pm25 = pm25_lookup(series, ts, fallback)
        cloudiness = cloudiness_for(ts)
        rows.append(
            {
                "timestamp": iso_z(ts),
                "municipality": focus["city"],
                "pm25": None if pm25 is None else round(float(pm25), 3),
                "cloudiness": cloudiness,
                "generation_kw": synthetic_generation(ts, cloudiness, pm25),
                "synthetic": True,
            }
        )
    return rows
