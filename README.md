# Airwize

Live air quality, 24-hour forecasts and threshold alerts for the municipalities
of one Philippine province (Laguna by default), from Plume Labs — plus a
clearly-labelled synthetic solar outlook and rules-based recommendations that
connect PM2.5 to rooftop generation.

Two services work together:

| Service | Language | Job |
|---|---|---|
| `webscraper/` | Go | Scrapes Plume Labs concurrently every 5 minutes and serves the latest snapshot at `GET /api/readings`. The **only** component that talks to Plume Labs. |
| `web.py` + `webapp/` + `dashboard/` | Python / Flask | Serves the dashboard, proxies `/api/readings` from the Go scraper unchanged, and computes the synthetic solar forecast plus recommendations at `GET /api/solar-forecast`. |

```
browser ──(every 60 s)──▶ Flask :5000  /api/readings ──▶ Go scraper :8080  /api/readings
                              │                               │ (in-memory snapshot,
                              └─ /  dashboard page            │  refreshed every 5 min)
                                                              ▼
                                                     air.plumelabs.com
```

## How to run

### Requirements

- Go 1.27 or newer: `go version`
- Python 3.10 or newer (tested on 3.12 and 3.14): `python3 --version`
- `requirements.txt` now includes scikit-learn for the two tiny solar forecast
  models; install it with the rest in the setup step below.

### 1. One-time setup

Run this on a fresh clone, and again after `requirements.txt` changes — the
solar endpoint needs the scikit-learn added for its two forecast models:

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

On Windows the interpreter and pip live under `venv\Scripts\` instead (for
example `venv\Scripts\python -m unittest ...`).

### 2. Start the Go scraper (terminal 1)

```bash
cd webscraper
go run . -serve :8080 -interval 5m
```

It scans Plume Labs, refreshes every 5 minutes and serves the readings at
<http://localhost:8080/api/readings>. Leave it running.

### 3. Start the Flask dashboard (terminal 2, from the project root)

```bash
venv/bin/python web.py
```

If you activated the venv first (`source venv/bin/activate`), `python web.py` is enough.
For development with auto-reload, use `venv/bin/flask --app web run --debug`.

### 4. Open the dashboard

Go to <http://127.0.0.1:5000>.

The scraper's first pass takes about 30 seconds. Until it finishes, the dashboard shows
"Collecting the first readings". After that, the page refreshes the data every minute
on its own.

To stop the app, press `Ctrl+C` in each terminal.

### Common variations

```bash
# Scraper on another address or port
cd webscraper && go run . -serve :9000
AIRWIZE_SCRAPER_URL=http://localhost:9000 venv/bin/python web.py

# Dashboard on another port, or reachable from your local network
AIRWIZE_PORT=8000 venv/bin/python web.py
AIRWIZE_HOST=0.0.0.0 venv/bin/python web.py

# Work on the UI without hitting Plume Labs (serves test-only readings on :8080)
venv/bin/python -m tests.fake_scraper     # use this instead of step 2
```

### Troubleshooting

- **"Readings are unavailable"**: Flask can't reach the scraper. Check that terminal 1
  is still running, and that `curl http://localhost:8080/api/readings` returns JSON. If
  the scraper runs somewhere else, set `AIRWIZE_SCRAPER_URL`.
- **"Address already in use"**: another program is using port 8080 or 5000. Pick other
  ports as shown above.
- **`ModuleNotFoundError: flask`**: you ran the system Python. Use `venv/bin/python`, or
  activate the venv first.

## Configuration

Settings live in `config.py`. Each one can be overridden with an environment variable:

| Variable | Default | Meaning |
|---|---|---|
| `AIRWIZE_SCRAPER_URL` | `http://localhost:8080` | Base URL of the Go scraper |
| `AIRWIZE_SCRAPER_TIMEOUT` | `5` | Seconds to wait for the scraper before reporting it unavailable |
| `AIRWIZE_POLL_INTERVAL_MS` | `60000` | How often the browser refreshes readings and the solar forecast |
| `AIRWIZE_HOST` / `AIRWIZE_PORT` | `127.0.0.1` / `5000` | Where `python web.py` listens |
| `AIRWIZE_SOLAR_SITE_NAME` | `demo-laguna-site` | Display name / cloud seed for the synthetic array |
| `AIRWIZE_SOLAR_PEAK_KW` | `5.0` | Nameplate capacity of the synthetic array |
| `AIRWIZE_POLLUTION_ATTENUATION_K` | `0.002` | PM2.5 attenuation coefficient `clamp(1 - k × PM2.5, 0.6, 1.0)` |
| `AIRWIZE_PM25_HIGH` | `35` | PM2.5 threshold (µg/m³) for warnings and recommendations |
| `AIRWIZE_PM25_CRITICAL` | `75` | PM2.5 level cited as critical in recommendation evidence |

Example: `AIRWIZE_SCRAPER_URL=http://10.0.0.5:9000 venv/bin/python web.py`

## Architecture

```
web.py                         entry point: create_app() and app.run()
config.py                      all settings (env-overridable)
requirements.txt               Flask + scikit-learn; the HTTP client and tests are stdlib
webapp/
  __init__.py                  app factory; points Flask at dashboard/templates and dashboard/static
  routes/pages.py              GET /             renders the dashboard page
  routes/api.py                GET /api/readings (proxy) and GET /api/solar-forecast
  services/readings_client.py  urllib client for the scraper, with an explicit timeout
  services/solar_sim.py        synthetic generation + paired PM2.5/solar dataset
  services/forecast.py         baseline and AQI-augmented LinearRegression models
  services/recommendations.py  rules-based solar and air-quality actions
dashboard/                     all front-end code (see dashboard/README.md)
  templates/                   Jinja: index.html + partials (top bar, icons, solar card)
  static/css/                  design tokens, base, app, motion, solar
  static/js/                   ES modules, no build step (solar.js owns the card)
webscraper/                    Go scraper (unchanged)
tests/                         unittest suite + fake scraper + fixtures
docs/                          MVP notes, demo script, backup screenshots
```

**The proxy.** `GET /api/readings` forwards the Go scraper's body byte for byte, so the
JSON schema is exactly `Snapshot` in `webscraper/main.go`. When the scraper can't be
reached it answers `502`, or `504` on timeout, with `{"error": "..."}`. The dashboard
then shows "Readings are unavailable". If it already had data, it keeps showing that
data with a "Some readings may be out of date" note. Flask does no scraping, parsing,
filtering or server-side polling.

**The synthetic solar outlook (demo data).** There is no inverter behind this repo.
`GET /api/solar-forecast` reads the same real snapshot, pairs each hour's PM2.5 with a
generated kW value (half-sine daylight, deterministic clouds, PM2.5 attenuation), fits
two `LinearRegression` models — weather-only and AQI-augmented — and returns a 24-hour
forecast plus rules-based recommendations. Every row is marked `"synthetic": true` and
the dashboard labels it in the card, the source line and the API. PM2.5 itself is real
Plume Labs data. See `docs/mvp-plan.md` for the full contract and `docs/demo-script.md`
for the walkthrough and the honesty line.

**Browser state.** Alert rules (`laguna-air.alerts`) and the theme (`laguna-air.theme`)
are kept in `localStorage`, under the same keys the earlier React dashboard used, so
existing rules carry over. The view, level filter, sort order and selected
municipality are kept in the query string.

## Tests

The tests never contact Plume Labs. They run against `tests/fake_scraper.py`, which
serves `tests/fixtures/snapshot.json`: synthetic, test-only readings in the Go schema.
A schema test checks that fixture against the Go struct tags, so if `main.go` changes
the test fails.

```bash
venv/bin/python -m unittest discover -s tests -t . -v   # Flask app
cd webscraper && go test ./...                          # Go scraper
```

To work on the UI without hitting Plume Labs, run the fake in place of the scraper:

```bash
venv/bin/python -m tests.fake_scraper --scenario hazy    # or clear, or no scenario
venv/bin/python web.py
```

`--scenario hazy` makes several municipalities exceed 35 µg/m³ with a rising trend;
`--scenario clear` keeps the province clean. Both are for demo rehearsal only and never
contact Plume Labs. The other fake modes are `--mode pending | partial`.

## Known limitations

- Readings live only in the Go scraper's memory, so restarting it means waiting for a new first pass.
- Alert rules are per browser. Notifications fire only while the dashboard tab is open and permission has been granted.
- The forecast chart's morph between municipalities is drawn in JS and works everywhere. The table sparklines morph only in browsers that can transition the CSS `d` property (Chromium, Firefox). Safari swaps them instantly.
- The Switzer font loads from Fontshare. Offline, the page falls back to the system sans-serif.
- Solar generation is synthetic demo data, not a validated photovoltaic model. The two
  forecasters are deliberately small linear regressions; there is no held-out validation
  against real inverter output. The real deliverable is the pipeline, the labelled UI and
  the auditable recommendation rules.
