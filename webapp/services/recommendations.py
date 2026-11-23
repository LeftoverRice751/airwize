"""Rules-based recommendations for the Airwize demo.

Input is the live snapshot plus the 24-hour dual forecast produced by
:mod:`webapp.services.forecast`. Output is a short list of explainable actions,
each carrying the evidence that triggered it — no model, no hidden score, just
thresholds a judge (or an LGU officer) can audit.

The rules are evaluated for the *snapshot's* observation time rather than the
wall clock, so a fixture can reproduce a hazy November morning. "The same
condition" in the straw-collection rule means the air-quality condition (at
least two municipalities above ``AIRWIZE_PM25_HIGH``); it is not restricted to
the patrol time windows.
"""

from __future__ import annotations

from datetime import timedelta
from statistics import mean
from typing import Any

from .solar_sim import MANILA, as_datetime, focus_municipality, municipality_pm25, observed_at, setting

PATROL_WINDOWS = ((5, 8), (17, 20))
COOKING_WINDOWS = ((5, 8), (17, 20))
HARVEST_MONTHS = {10, 11, 12, 3, 4}
DAYLIGHT_HOURS = 12.0  # 06:00–18:00, for the kWh/day estimate
INDUSTRIAL_KEYS = ("dominant_source", "source", "industrial_source")


def _in_windows(hour: int, windows: tuple[tuple[int, int], ...]) -> bool:
    return any(start <= hour < end for start, end in windows)


def _has_industrial_flag(municipalities: list[dict], snapshot: dict) -> bool:
    """Whether the snapshot says an industrial source dominates.

    The current Go schema has no source attribution at all, so this is false
    for live data. It is written defensively so a future field does not make
    the clean-cooking recommendation contradict the data.
    """
    candidates: list[dict] = [snapshot, *municipalities]
    for item in candidates:
        for key in INDUSTRIAL_KEYS:
            value = item.get(key)
            if isinstance(value, str) and "industr" in value.lower():
                return True
            if value is True:
                return True
    return False


def _municipality_rows(snapshot: dict) -> list[tuple[str, float | None]]:
    rows: list[tuple[str, float | None]] = []
    for municipality in snapshot.get("municipalities") or []:
        if not isinstance(municipality, dict):
            continue
        name = municipality.get("city") or municipality.get("municipality")
        if name:
            rows.append((str(name), municipality_pm25(municipality)))
    return rows


def _daylight_deltas(forecast: list[dict]) -> list[float]:
    daylight = [r for r in forecast if _number(r.get("baseline_kw")) > 0]
    source = daylight or forecast
    return [_number(r.get("delta_pct")) for r in source if r.get("delta_pct") is not None]


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def _window(forecast: list[dict], threshold: float = -5.0) -> tuple[str, str, float] | None:
    """Earliest to latest hour whose AQI-aware forecast is below threshold."""
    hits = [r for r in forecast if _number(r.get("baseline_kw")) > 0 and _number(r.get("delta_pct")) < threshold]
    if not hits:
        return None
    start = min(hits, key=lambda r: str(r.get("timestamp"))).get("timestamp")
    end_ts = max(hits, key=lambda r: str(r.get("timestamp"))).get("timestamp")
    end_dt = as_datetime(end_ts)
    end = (end_dt + timedelta(hours=1)) if end_dt is not None else end_ts
    worst = min(_number(r.get("delta_pct")) for r in hits)
    return str(start), str(end), worst


def _manila_label(timestamp: Any) -> str:
    dt = as_datetime(timestamp)
    return dt.astimezone(MANILA).strftime("%H:%M") if dt is not None else "—"


def recommend(snapshot: dict, forecast: list[dict]) -> list[dict]:
    """Return solar and air-quality recommendations, most consequential first.

    Each item is ``{"category": "solar"|"air", "severity": "info"|"warn",
    "text": str, "evidence": dict}``. At most one solar item is returned (the
    first matching rule wins); air-quality rules are independent.
    """
    high = float(setting("AIRWIZE_PM25_HIGH", 35.0))
    critical = float(setting("AIRWIZE_PM25_CRITICAL", 75.0))
    peak = float(setting("AIRWIZE_SOLAR_PEAK_KW", 5.0))

    rows = _municipality_rows(snapshot)
    values = [pm25 for _, pm25 in rows if pm25 is not None]
    pm25_max = max(values) if values else None
    elevated = sorted(name for name, pm25 in rows if pm25 is not None and pm25 > high)

    observed = observed_at(snapshot).astimezone(MANILA)
    hour, month = observed.hour, observed.month

    deltas = _daylight_deltas(forecast)
    mean_delta = mean(deltas) if deltas else 0.0
    focus = focus_municipality(snapshot)
    focus_name = str(focus.get("city")) if focus else None
    subjects = elevated or ([focus_name] if focus_name else [])

    items: list[dict] = []

    # ---- Solar rules: first match wins -------------------------------------
    if pm25_max is not None and pm25_max > high and mean_delta < -10.0:
        recovery = abs(mean_delta) / 100.0 * peak * DAYLIGHT_HOURS
        items.append(
            {
                "category": "solar",
                "severity": "warn",
                "text": (
                    f"Haze is cutting the demo array's daylight output by about {abs(mean_delta):.0f}%. "
                    f"Cleaning the panels is the cheapest recovery: roughly {recovery:.1f} kWh/day at the "
                    f"{peak:.1f} kW demo site."
                ),
                "evidence": {
                    "municipalities": elevated,
                    "pm25_max": round(pm25_max, 1),
                    "pm25_high": high,
                    "pm25_critical": critical,
                    "mean_delta_pct": round(mean_delta, 2),
                    "estimated_recovery_kwh_day": round(recovery, 2),
                    "peak_kw": peak,
                },
            }
        )
    elif mean_delta < -5.0:
        window = _window(forecast)
        if window is not None:
            start, end, worst = window
            start_label, end_label = _manila_label(start), _manila_label(end)
            items.append(
                {
                    "category": "solar",
                    "severity": "info",
                    "text": (
                        f"Haze is forecast to trim solar output by up to {abs(worst):.0f}% during daylight. "
                        f"Pre-charge batteries or defer non-essential loads between {start_label} and "
                        f"{end_label} Manila time."
                    ),
                    "evidence": {
                        "municipalities": subjects,
                        "mean_delta_pct": round(mean_delta, 2),
                        "window_start": start,
                        "window_end": end,
                        "pm25_max": None if pm25_max is None else round(pm25_max, 1),
                    },
                }
            )

    # ---- Air-quality rules -------------------------------------------------
    if len(elevated) >= 2:
        base_evidence = {
            "municipalities": elevated,
            "pm25_max": round(pm25_max, 1) if pm25_max is not None else None,
            "pm25_high": high,
            "local_hour": hour,
        }
        if _in_windows(hour, PATROL_WINDOWS):
            items.append(
                {
                    "category": "air",
                    "severity": "warn",
                    "text": (
                        f"PM2.5 is above {high:g} µg/m³ in {len(elevated)} municipalities during a "
                        "burning-prone hour. Send LGU patrols for biomass burning in the listed barangays."
                    ),
                    "evidence": {**base_evidence, "window": "05:00–08:00 or 17:00–20:00"},
                }
            )

        if month in HARVEST_MONTHS:
            items.append(
                {
                    "category": "air",
                    "severity": "info",
                    "text": (
                        f"PM2.5 is elevated in {len(elevated)} municipalities during a rice-harvest month "
                        f"({month:02d}). Promote centralized rice-straw collection, following the Pila "
                        "collection facility precedent."
                    ),
                    "evidence": {
                        **base_evidence,
                        "month": month,
                        "precedent": "Pila rice-straw collection facility (Laguna)",
                    },
                }
            )

        if _in_windows(hour, COOKING_WINDOWS) and not _has_industrial_flag(
            [m for m in snapshot.get("municipalities") or [] if isinstance(m, dict)], snapshot
        ):
            items.append(
                {
                    "category": "air",
                    "severity": "info",
                    "text": (
                        "Elevated PM2.5 during cooking hours, with no dominant industrial source in the "
                        "snapshot, points to household solid-fuel use. Promote clean cooking (SDG 7.1.2)."
                    ),
                    "evidence": {**base_evidence, "sdg": "7.1.2", "dominant_industrial_source": False},
                }
            )

    return items


__all__ = ["recommend"]
