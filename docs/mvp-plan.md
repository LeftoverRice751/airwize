# Airwize MVP — implementation notes

This is the Phase 0 reconnaissance note, kept next to the code as the contract
the solar module consumes. It is deliberately specific: if the Go scraper
changes, this file and `tests/fixtures/snapshot.json` are what to update.

## Phase 0 — what exists and what we consume

The Go scraper (`webscraper/main.go`) owns all Plume Labs scraping. Flask only
forwards its in-memory snapshot. The new solar feature reads that same snapshot
through the existing `ReadingsClient`; it never talks to Plume Labs itself.

### Snapshot schema (exact fields consumed)

`GET /api/readings` returns `Snapshot`:

| Field | Type | Used for |
|---|---|---|
| `province` | string | Echoed into the solar payload for context. |
| `updated_at` | RFC 3339 string or `null` | Observation time for the synthetic series and recommendations. `null` before the first scrape pass. |
| `municipalities` | array of `AirQuality` | One row per city/municipality in the province. |
| `error` | string, omitted when empty | Partial-failure message. Passed through by the proxy; not consumed by the solar maths. |

Each `AirQuality` row (only consumed fields listed):

| Field | Type | Used for |
|---|---|---|
| `city` | string (e.g. `"Calamba"`) | **Municipality identifier.** Matches the dashboard table's key and `url-state` selection. |
| `municipality` | string (e.g. `"City of Calamba"`) | Full administrative name, shown alongside `city` where useful. |
| `province`, `region` | string | Context only. |
| `latitude`, `longitude` | number | Not consumed (single demo site). |
| `plume_index`, `level` | number, string | Not consumed by solar; the existing AQI card owns them. |
| `pollutants` | object keyed by pollutant code | `pollutants.PM25.value_upm` is the real PM2.5 concentration in µg/m³ used for attenuation. |
| `pollutants.PM25.pi` | number | Sub-index only; **not** used as a concentration. |
| `weather` | `{icon, temperature, uv}` | Context only; cloudiness is synthetic (see below). |
| `advice` | string | Not consumed. |
| `forecast` | array of `ForecastPoint` | The real hourly PM2.5 series (`forecast[].values.PM25.value_upm`) covering roughly the previous 24 h and the next 24 h. Used to give the AQI model a varying, real PM2.5 signal. |
| `forecast[].timestamp` | Unix seconds | Hour keys for the PM2.5 series. |
| `measured_at`, `fetched_at` | RFC 3339 strings | Fallback observation time / freshness. |

`ForecastPoint` is only consumed through `timestamp` and
`values.PM25.value_upm`. Missing `PM25` at a point is allowed; the nearest
available value within two hours is used.

### Existing files confirmed

| File | Confirmed behaviour |
|---|---|
| `webapp/routes/api.py` | `/api/readings` forwards the scraper body byte for byte, `502` on unreachable, `504` on timeout, `Cache-Control: no-store`. The solar route is added alongside it; the proxy is untouched. |
| `webapp/services/readings_client.py` | Standard-library `urllib` with a configurable timeout; raises `ScraperTimeout` (a `ScraperUnavailable`) so the route can map timeouts to `504` and everything else to `502`. Also derives the browser-facing WebSocket URL for live readings. |
| `config.py` | `Config` class attributes, every one overridable by an `AIRWIZE_*` environment variable via `_float`/`_int`. New settings follow the same pattern. |
| `dashboard/static/js/app.js` | One ES-module entry point. Live readings arrive via `ReadingsStream` over `WS /ws/readings` (HTTP `/api/readings` remains the retry fallback). The solar module is imported here and polls `/api/solar-forecast` on `poll_interval_ms` (60 s). |
| `dashboard/templates/index.html` | Single page; the monitor view is `#view-monitor` (province strip, table, detail panel). **The partial added for the solar feature is `dashboard/templates/partials/solar_card.html`, inside the separate `#view-outlook` tab.** |
| `tests/fake_scraper.py` + `tests/fixtures/snapshot.json` | In-process HTTP and WebSocket fake serving the fixture with timestamps rebased to "now". The solar tests reuse it, so no test contacts Plume Labs. |
| `dashboard/static/js/features/forecast-chart.js` | Hand-rolled SVG chart with `ResizeObserver`, time ticks in Manila time, and CSS-variable styling. The solar chart follows the same approach but stays self-contained in `solar.js`. |

## Design decisions for the synthetic layer

These are the choices that turn the plan into deterministic, testable code.

1. **Focus municipality.** The solar outlook describes one demo site, so it
   picks the municipality with the **highest current PM2.5** (ties broken by
   city name). This makes the haze/solar story visible and is deterministic
   for a given snapshot. The recommendation engine still looks at *all*
   municipalities.
2. **PM2.5 is real, generation is synthetic.** `build_paired_dataset` places
   each hour on the snapshot's PM2.5 series (measured value plus Plume Labs'
   hourly forecast where available) and generates the kW value from
   `synthetic_generation`. Every row carries `"synthetic": true`.
3. **Cloudiness is deterministic pseudo-random.** A SHA-256 of
   `site:YYYY-MM-DDTHH` (Manila hour) seeds a value in `[0, 0.85]`, biased
   toward clear skies. Same hour, same site, same cloudiness — demos repeat
   exactly.
4. **Sine irradiance.** Zero outside 06:00–18:00 Manila, peak at 12:00, with
   `PEAK_KW = AIRWIZE_SOLAR_PEAK_KW` (default 5.0). Cloud attenuation is a
   fixed 65 % at full cloud. Pollution attenuation is
   `clamp(1 - k * pm25, 0.6, 1.0)` with
   `k = AIRWIZE_POLLUTION_ATTENUATION_K` (default 0.002).
5. **Forecast models.** `sklearn.linear_model.LinearRegression`.
   - baseline: `hour_of_day`, `cloudiness`
   - AQI-augmented: `hour_of_day`, `cloudiness`, `pm25`
   The models predict a **clear-sky-normalised output** (kW ÷ solar elevation)
   and the forecast multiplies it back by the elevation at each timestamp. That
   keeps the physical half-sine shape while the coefficients describe how
   clouds and PM2.5 move output relative to a clear sky. Predictions are then
   clamped to `[0, PEAK_KW]` and forced to zero outside daylight, because a
   linear model should not invent night-time solar.
6. **Degraded mode.** If PM2.5 is absent (or constant, so the model cannot
   learn a pollution effect), the AQI model falls back to the baseline, both
   columns are equal, and the payload says `"degraded": true`.
7. **The card's plain-language note.** It takes the maximum `delta_pct` across
   **daylight rows** (where `baseline_kw > 0`), not all 24 rows: night rows are
   zero by construction, so including them would cap the maximum at 0 and the
   "Haze expected" message could never appear. The wording is otherwise exactly
   the one in the implementation plan.
8. **Recommendation time.** Rules use the snapshot's `updated_at` (Manila
   time), not the wall clock, so a fixture can reproduce a hazy morning or a
   November harvest day. `recommend()` falls back to now only when the
   snapshot has no observation time.
9. **One endpoint.** The solar endpoint returns the forecast *and* the
   recommendations, so the dashboard makes one extra request per minute.
10. **Grounded advisor.** The Outlook and Energy tabs now share
    `services/ai_advisor.py`. A deterministic planner computes the kWh loss,
    cleaning window, maintenance cadence and pre-charge window; an optional
    LLM may only rewrite/reorder those candidates. Without a key (or on any
    model failure) the planner's output is used, so the demo works offline.

## API contract added

`GET /api/solar-forecast` (Flask)

```json
{
  "generated_at": "2026-11-23T14:06:25Z",
  "site": "demo-laguna-site",
  "municipality": "Calamba",
  "province": "Laguna",
  "current_kw": 0.0,
  "pm25": 12.7,
  "peak_kw": 5.0,
  "synthetic": true,
  "degraded": false,
  "advisor": {
    "mode": "smart",
    "label": "Smart plan",
    "fallback": false
  },
  "forecast": [
    {
      "timestamp": "2026-11-23T15:00:00Z",
      "baseline_kw": 1.42,
      "aqi_kw": 1.31,
      "delta_pct": -7.75,
      "pm25": 14.2,
      "cloudiness": 0.18
    }
  ],
  "recommendations": [
    {
      "category": "solar",
      "severity": "warn",
      "text": "…",
      "evidence": {
        "municipalities": ["Calamba", "Los Baños"],
        "estimated_recovery_kwh_day": 2.1,
        "window_start": "2026-11-24T23:00:00Z",
        "window_end": "2026-11-25T02:00:00Z",
        "maintenance": "Clean every 2–3 days while PM2.5 stays above 75 µg/m³."
      }
    }
  ]
}
```

`advisor.mode` is `smart` (local planner), `ai` (LLM-rewritten) or `rules`
(legacy). The LLM never replaces the evidence; it only rewrites and reorders
the planner's candidates. `fallback` is true when an AI mode was requested but
the planner answered instead.

`forecast` has 24 hourly rows. `delta_pct` is zero when `baseline_kw` is zero
(night) to avoid dividing by zero. Errors mirror the proxy: `502` when the
scraper is unreachable or the snapshot is unusable, `504` on timeout, with
`{"error": "..."}` and `Cache-Control: no-store`.

## Tests

```bash
python -m unittest discover -s tests -v
```

The suite uses only `tests/fake_scraper.py` and fixtures; no network. The new
tests are `test_solar_sim.py`, `test_forecast.py`, `test_api_solar.py`,
`test_recommendations.py` and `test_ai_advisor.py` (the latter uses a local fake
chat-completions server for the optional LLM path).

## Explicit non-goals

Real inverter integration, validation against real generation, multi-province
rollout, a second backend service, battery/generator control, and automated
panel cleaning. The dashboard labels the generation as synthetic everywhere it
appears.
