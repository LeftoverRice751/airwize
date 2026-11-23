"""Builders for the small snapshots the solar tests need.

They imitate only the parts of the Go schema the solar modules consume; the
full-schema fixture stays in ``tests/fixtures/snapshot.json``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

MANILA = timezone(timedelta(hours=8))


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def municipality(
    city: str,
    pm25: float | None,
    now: datetime,
    forecast_pm25: list[tuple[datetime, float]] | None = None,
) -> dict:
    pollutants = {} if pm25 is None else {"PM25": {"pi": float(pm25), "value_upm": float(pm25)}}
    forecast = [
        {
            "plume_index": float(value),
            "plume_index_level": 2,
            "timestamp": int(ts.timestamp()),
            "values": {"PM25": {"pi": float(value), "value_upm": float(value)}},
            "weather": {"icon": "partly-cloudy", "temperature": 29.0, "uv": 5.0},
        }
        for ts, value in (forecast_pm25 or [])
    ]
    return {
        "city": city,
        "municipality": f"City of {city}",
        "province": "Laguna",
        "region": "Calabarzon",
        "url": f"https://air.plumelabs.com/air-quality-in-{city}-test",
        "latitude": 14.2,
        "longitude": 121.2,
        "plume_index": float(pm25 or 20.0),
        "level": "fair",
        "pollutants": pollutants,
        "weather": {"icon": "partly-cloudy", "temperature": 29.0, "uv": 5.0},
        "advice": "Test reading.",
        "forecast": forecast,
        "measured_at": iso(now),
        "fetched_at": iso(now),
    }


def snapshot(now: datetime, municipalities: list[dict], province: str = "Laguna") -> dict:
    return {"province": province, "updated_at": iso(now), "municipalities": municipalities}


def hourly(now: datetime, values: list[float], start_hours_ago: int | None = None) -> list[tuple[datetime, float]]:
    """Hourly points ending at ``now``'s hour; ``start_hours_ago`` shifts the end."""
    end = now.replace(minute=0, second=0, microsecond=0)
    first = len(values) - 1
    start = start_hours_ago if start_hours_ago is not None else first
    return [(end - timedelta(hours=start - i), value) for i, value in enumerate(values)]
