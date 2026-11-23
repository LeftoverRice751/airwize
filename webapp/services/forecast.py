"""Two tiny solar forecasters: weather-only vs AQI-augmented.

Both are plain ``sklearn.linear_model.LinearRegression`` models trained on the
paired dataset from :mod:`webapp.services.solar_sim`:

* baseline: ``hour_of_day``, ``cloudiness``
* AQI:      ``hour_of_day``, ``cloudiness``, ``pm25``

Instead of fitting raw kW — where night-time zeros and a half-sine daylight
curve make a straight line a poor fit — the models predict a **clear-sky
normalised output** (kW divided by the solar elevation), and the forecast
multiplies that back by the elevation for its timestamp. This is a standard
solar-forecasting trick: the learned coefficients then describe how clouds and
PM2.5 change output relative to a clear sky, while the time-of-day shape comes
from the same physical curve used by the generator. Night rows carry no
information and are excluded from training.

The point is not accuracy on real generation (there is none to validate
against) but a transparent, reproducible contrast: the same synthetic array,
forecast once without air quality and once with it. Predictions are clamped to
physical bounds and forced to zero outside daylight.

If PM2.5 is missing from the snapshot — or constant, so the model cannot learn
a pollution effect — the AQI model falls back to the baseline and the result is
marked ``degraded``.
"""

from __future__ import annotations

from datetime import timedelta, timezone
from typing import Any

from sklearn.linear_model import LinearRegression

from .solar_sim import (
    MANILA,
    as_datetime,
    cloudiness_for,
    focus_municipality,
    iso_z,
    municipality_pm25,
    observed_at,
    peak_kw,
    pm25_lookup,
    pm25_series,
    solar_elevation,
)

UTC = timezone.utc


def hour_of_day(ts: Any) -> float:
    """Fractional hour in Manila local time (13.5 for 13:30)."""
    dt = as_datetime(ts)
    if dt is None:
        return 0.0
    local = dt.astimezone(MANILA)
    return local.hour + local.minute / 60 + local.second / 3600


def _training_set(rows: list[dict], with_pm25: bool) -> tuple[list[list[float]], list[float]]:
    """Features and clear-sky-normalised targets for the daylight rows."""
    X: list[list[float]] = []
    y: list[float] = []
    for row in rows:
        elevation = solar_elevation(row.get("timestamp"))
        if elevation <= 0.0 or row.get("generation_kw") is None or row.get("cloudiness") is None:
            continue
        features = [hour_of_day(row["timestamp"]), float(row["cloudiness"])]
        if with_pm25:
            pm25 = row.get("pm25")
            if pm25 is None:
                continue
            features.append(float(pm25))
        X.append(features)
        y.append(float(row["generation_kw"]) / elevation)
    return X, y


def train_models(rows: list[dict]) -> dict:
    """Fit both models on paired rows; returns ``{"baseline", "aqi", ...}``."""
    X_baseline, y_baseline = _training_set(rows, with_pm25=False)
    if len(X_baseline) < 2:
        raise ValueError("at least two daylight rows are needed to fit the forecast models")

    baseline = LinearRegression().fit(X_baseline, y_baseline)

    X_aqi, y_aqi = _training_set(rows, with_pm25=True)
    pm25_values = {round(float(r["pm25"]), 6) for r in rows if r.get("pm25") is not None}
    # One distinct PM2.5 value carries no information beyond the intercept, and
    # a missing value cannot be learned at all: both cases are "degraded".
    degraded = len(X_aqi) < 2 or len(pm25_values) < 2
    aqi = baseline if degraded else LinearRegression().fit(X_aqi, y_aqi)

    return {
        "baseline": baseline,
        "aqi": aqi,
        "degraded": degraded,
        "trained_on": len(X_baseline),
        "pm25_values": len(pm25_values),
    }


def forecast_next_24h(models: dict, snapshot: dict, now: Any = None, hours: int = 24) -> list[dict]:
    """Predict the next ``hours`` hours with both models.

    Returns rows ``{timestamp, baseline_kw, aqi_kw, delta_pct, pm25,
    cloudiness}``. Night hours are zero for both models; ``delta_pct`` is zero
    when the baseline is zero so consumers never divide by zero.
    """
    if hours < 1:
        raise ValueError("hours must be at least 1")
    focus = focus_municipality(snapshot)
    if focus is None:
        raise ValueError("the snapshot contains no municipalities")

    baseline_model = models["baseline"]
    aqi_model = models.get("aqi", baseline_model)
    degraded = bool(models.get("degraded", False))

    series = pm25_series(snapshot, focus)
    latest_pm25 = municipality_pm25(focus)
    if latest_pm25 is None and series:
        latest_pm25 = series[-1][1]
    degraded = degraded or (latest_pm25 is None and not series)

    start = observed_at(snapshot, now).astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    limit = peak_kw()
    rows: list[dict] = []
    for step in range(hours):
        ts = start + timedelta(hours=step)
        cloudiness = cloudiness_for(ts)
        pm25 = pm25_lookup(series, ts, latest_pm25)
        if pm25 is None:
            pm25 = latest_pm25

        elevation = solar_elevation(ts)
        baseline_kw = 0.0
        aqi_kw = 0.0
        if elevation > 0.0:
            hour = hour_of_day(ts)
            baseline_kw = float(baseline_model.predict([[hour, cloudiness]])[0]) * elevation
            if degraded or pm25 is None:
                aqi_kw = baseline_kw
            else:
                aqi_kw = float(aqi_model.predict([[hour, cloudiness, float(pm25)]])[0]) * elevation
            baseline_kw = min(limit, max(0.0, baseline_kw))
            aqi_kw = min(limit, max(0.0, aqi_kw))

        baseline_kw = round(baseline_kw, 3)
        aqi_kw = round(aqi_kw, 3)
        delta_pct = ((aqi_kw - baseline_kw) / baseline_kw * 100.0) if baseline_kw > 1e-9 else 0.0

        rows.append(
            {
                "timestamp": iso_z(ts),
                "baseline_kw": baseline_kw,
                "aqi_kw": aqi_kw,
                "delta_pct": round(delta_pct, 2),
                "pm25": None if pm25 is None else round(float(pm25), 3),
                "cloudiness": cloudiness,
            }
        )
    return rows


__all__ = ["forecast_next_24h", "hour_of_day", "train_models"]
