# Airwize

Live air quality, 24-hour forecasts and threshold alerts for the municipalities
of one Philippine province (Laguna by default), from Plume Labs, plus a
clearly labelled synthetic Solar outlook with rules-based recommendations that
connect PM2.5 to rooftop generation, and an Energy tab for solar, grid,
generator and battery sites.

Two services work together:

| Service | Language | Job |
|---|---|---|
| `webscraper/` | Go | Scrapes Plume Labs concurrently every 5 minutes, serves `GET /api/readings`, and broadcasts `WS /ws/readings`. The **only** component that talks to Plume Labs. |
| `app.py` + `webapp/` + `dashboard/` | Python / Flask | Serves the dashboard, keeps `/api/readings` as a manual HTTP fallback, computes the synthetic solar forecast plus recommendations at `GET /api/solar-forecast`, and serves the Energy tab's endpoints (`/api/energy/*`). |

```
browser <==== WebSocket /ws/readings ==== Go scraper :8080
   |                                      | (in-memory snapshot,
   +---- Flask :5000 dashboard page       |  refreshed every 5 min)
   +---- HTTP /api/readings fallback -----+
                                          v
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

It scans Plume Labs, refreshes every 5 minutes, serves the current snapshot at
<http://localhost:8080/api/readings>, and pushes snapshots to WebSocket clients
at `ws://localhost:8080/ws/readings`. Leave it running.

### 3. Start the Flask dashboard (terminal 2, from the project root)

```bash
venv/bin/python app.py
```

If you activated the venv first (`source venv/bin/activate`), `python app.py` is enough.
For development with auto-reload, use `venv/bin/flask --app app run --debug`.

### 4. Open the dashboard

Go to <http://127.0.0.1:5000>.

The scraper's first pass takes about 30 seconds. Until it finishes, the dashboard shows
"Collecting the first readings". The open page receives that first result and every
later forecast automatically; it does not need a page refresh or polling interval.

### Verify real-time updates

- A green **Live** label means the browser received a valid snapshot over an open
  WebSocket and that snapshot is not stale.
- If the WebSocket closes, **Live** changes to `Updated ... ago`, the last snapshot
  remains visible, and the dashboard shows its automatic-reconnect warning.
- In browser developer tools, open **Network**, select the **WS** filter, and inspect
  `/ws/readings`. The handshake should be `101 Switching Protocols`; each completed
  scrape appears as a JSON message in the Messages/Frames panel.

The real scraper checks Plume Labs every five minutes by default, so "real time" means
the browser receives each completed scrape immediately. `tests.fake_scraper` exercises
the same WebSocket flow with synthetic data; it is not a source of live Plume Labs data.

To stop the app, press `Ctrl+C` in each terminal.

### Common variations

```bash
# Scraper on another address or port
cd webscraper && go run . -serve :9000
AIRWIZE_SCRAPER_URL=http://localhost:9000 venv/bin/python app.py

# Public WebSocket address (needed when SCRAPER_URL is private or proxied)
AIRWIZE_WEBSOCKET_URL=wss://air.example.com/ws/readings venv/bin/python app.py

# Dashboard on another port, or reachable from your local network
AIRWIZE_PORT=8000 venv/bin/python app.py
AIRWIZE_HOST=0.0.0.0 venv/bin/python app.py

# Work on the UI without hitting Plume Labs (serves test-only readings on :8080)
venv/bin/python -m tests.fake_scraper     # use this instead of step 2
```

### Troubleshooting

- **"Readings are unavailable"**: check that terminal 1 is still running and that
  `curl http://localhost:8080/api/readings` returns JSON. If the scraper runs somewhere
  else, set both `AIRWIZE_SCRAPER_URL` and, when needed, `AIRWIZE_WEBSOCKET_URL`.
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
| `AIRWIZE_WEBSOCKET_URL` | derived from `AIRWIZE_SCRAPER_URL` | Browser-accessible `ws://` or `wss://` readings stream |
| `AIRWIZE_ENERGY_ADAPTER` | empty | Energy tab, live mode: name of the solar Wi-Fi module adapter. None ships yet, so live mode reports "not connected" |
| `AIRWIZE_ENERGY_DEVICE_ADDRESS` | empty | Network address of the module, passed to the adapter |
| `AIRWIZE_ENERGY_DEVICE_TIMEOUT` | `3` | Seconds to wait for the module |
| `AIRWIZE_ENERGY_POLL_INTERVAL_MS` | `10000` | How often the browser asks for a live energy reading |
| `AIRWIZE_ENERGY_OPTIMIZER` | empty | Provider for the Energy tab's suggestions. `rules` (default) shows the Solar outlook's rules-based recommendations; empty turns the area back into a placeholder |
| `AIRWIZE_POLL_INTERVAL_MS` | `60000` | How often the Solar outlook refreshes its forecast (readings arrive over the WebSocket) |
| `AIRWIZE_HOST` / `AIRWIZE_PORT` | `127.0.0.1` / `5000` | Where `python app.py` listens |
| `AIRWIZE_SOLAR_SITE_NAME` | `demo-laguna-site` | Display name / cloud seed for the synthetic array |
| `AIRWIZE_SOLAR_PEAK_KW` | `5.0` | Nameplate capacity of the synthetic array |
| `AIRWIZE_POLLUTION_ATTENUATION_K` | `0.002` | PM2.5 attenuation coefficient `clamp(1 - k × PM2.5, 0.6, 1.0)` |
| `AIRWIZE_PM25_HIGH` | `35` | PM2.5 threshold (µg/m³) for warnings and recommendations |
| `AIRWIZE_PM25_CRITICAL` | `75` | PM2.5 level cited as critical in recommendation evidence |

Example: `AIRWIZE_SCRAPER_URL=http://10.0.0.5:9000 venv/bin/python app.py`

## Architecture

```
app.py                         entry point: create_app() and app.run()
config.py                      all settings (env-overridable)
requirements.txt               Flask + scikit-learn; the HTTP client and tests are stdlib
webapp/
  __init__.py                  app factory; points Flask at dashboard/templates and dashboard/static
  routes/pages.py              GET /             renders the dashboard page
  routes/api.py                GET /api/readings (proxy) and GET /api/solar-forecast
  routes/energy.py             GET /api/energy/live, POST /api/energy/suggestions
  services/readings_client.py  urllib client for the scraper, with an explicit timeout
  services/solar_sim.py        synthetic generation + paired PM2.5/solar dataset
  services/forecast.py         baseline and AQI-augmented LinearRegression models
  services/recommendations.py  rules-based solar and air-quality actions
  services/solar_outlook.py    builds the Solar outlook payload (shared by both endpoints)
  services/energy_device.py    solar Wi-Fi module interface (adapters), separate from the scraper
  services/energy_optimization.py  Energy tab suggestions: provider registry ("rules" built in)
dashboard/                     all front-end code (see dashboard/README.md)
  templates/                   Jinja: index.html + partials (top bar, icons, solar card)
  static/css/                  design tokens, base, app, motion, solar, energy
  static/js/                   ES modules, no build step (solar.js owns the Solar outlook card)
webscraper/                    Go scraper, HTTP snapshot and WebSocket broadcast
tests/                         unittest suite + fake scraper + fixtures
docs/                          MVP notes, demo script, backup screenshots
```

**Real-time updates.** The browser opens `WS /ws/readings` on the Go scraper. It receives
the current snapshot immediately, then another snapshot as soon as each scrape pass
finishes. If the connection drops, the browser retries automatically with exponential
backoff. `AIRWIZE_WEBSOCKET_URL` must be reachable by the browser; set it explicitly when
`AIRWIZE_SCRAPER_URL` uses an internal hostname or TLS ends at a reverse proxy.

**The HTTP fallback.** `GET /api/readings` forwards the Go scraper's body byte for byte, so the
JSON schema is exactly `Snapshot` in `webscraper/main.go`. When the scraper can't be
reached it answers `502`, or `504` on timeout, with `{"error": "..."}`. The dashboard
uses it when the user presses Refresh. If it already had data, it keeps showing that
data with a "Some readings may be out of date" note. Flask does no scraping, parsing,
filtering or server-side polling.

**The synthetic solar outlook (demo data).** There is no inverter behind this repo.
`GET /api/solar-forecast` reads the same real snapshot, pairs each hour's PM2.5 with a
generated kW value (half-sine daylight, deterministic clouds, PM2.5 attenuation), fits
two `LinearRegression` models — weather-only and AQI-augmented — and returns a 24-hour
forecast plus rules-based recommendations. Every row is marked `"synthetic": true` and
the dashboard labels it in the card, the source line and the API. PM2.5 itself is real
Plume Labs data. The card refreshes every `AIRWIZE_POLL_INTERVAL_MS`; only readings use
the WebSocket. See `docs/mvp-plan.md` for the full contract and `docs/demo-script.md`
for the walkthrough and the honesty line.

**Browser state.** Alert rules (`laguna-air.alerts`) and the theme (`laguna-air.theme`)
are kept in `localStorage`, under the same keys the earlier React dashboard used, so
existing rules carry over. The view, level filter, sort order, selected municipality
and the Energy tab's site type, mode and scenario are kept in the query string.

## Energy tab

Open it from the navigation sidebar, or go to `?view=energy`. Pick a **site type** (solar site,
grid connection, generator site, battery bank) and an **operating mode**. The heading,
tiles, explanations and chart all adapt to the site type:

| Site type | Tiles | Chart |
|---|---|---|
| Solar site | Stored energy, Draining/Trend, Load, Solar, Outside | Stored energy (%) |
| Grid connection | Load, Outside | Load (W) |
| Generator site | Stored energy and Draining/Trend (if it has storage), Load, Generator, Outside | Stored energy, or load without storage |
| Battery bank | Stored energy, Draining/Trend, Load, Outside | Stored energy (%) |

Every tile carries a tag saying where its value came from: **Simulated**, **Scripted** or **Live**.

### Simulation-only mode

Runs scripted demo data and needs no energy system, Wi-Fi or even the Go scraper.
The "Simulated data" panel has five scenarios: Typical day, Heat wave, Hazy afternoon,
Appliance on and Evening drain. Each one plays six hours on a demo clock, at one demo
minute per half second. Click the active scenario again to restart it. Outside
conditions (temperature, UV, air quality, forecast) are scripted as well, for Calamba,
and the heading says so.

The scenario numbers in `dashboard/static/js/lib/energy/scenarios.js` and the model in
`simulation.js` (2 kW panels, a 14 kWh solar battery, a 2.4 kW generator that starts below 35%
charge, a 48 V pack) are **illustrative, not measured**. Replace them with recorded values
from a real site when you have them.

### Live mode

The browser polls `GET /api/energy/live` every 10 seconds while the tab is open. Flask
asks the configured adapter in `webapp/services/energy_device.py` for one reading. The
answer's `state` is one of:

- `connected`: the reading is shown.
- `disconnected`: the module didn't answer.
- `error`: the module or adapter failed.
- `not_configured`: no adapter is set up.

Values the device doesn't report stay empty ("Not reported by the device"). They are
never filled in from the simulation. The trend chart uses only readings received since the
page opened. Outside conditions come live from the Go scraper's snapshot (temperature,
UV, Plume index and the forecast's next 6 hours) for the municipality chosen in the
connection panel. The energy device code never touches the scraper.

**Status: no solar Wi-Fi module is supported yet.** No brand, protocol or API is
assumed, so live mode currently shows "Not connected". To add a module, write an
adapter class with `read(timeout) -> EnergyReading` and register it in `ADAPTERS`. Then start
Flask with `AIRWIZE_ENERGY_ADAPTER=<name> AIRWIZE_ENERGY_DEVICE_ADDRESS=<ip>`. The
docstring in `energy_device.py` has the steps. Before writing one, you need to know:

- how the module exposes data (local HTTP/JSON, Modbus TCP, MQTT, or a vendor cloud API)
- its address, port and authentication
- which values it reports (charge %, battery voltage, load, PV or generator power) and their units
- how often it may be polled

### "Why is it behaving this way?"

`dashboard/static/js/lib/energy/explain.js` turns the current readings, the scenario and
the outside forecast into plain-language guesses, such as heat driving cooling load, haze
dimming the panels, a jump in load, or a forecast temperature change. They are labelled
as estimates. A rule stays silent when a value it needs is missing.

### Energy optimization (rules now, AI later)

The panel right after "Why is it behaving this way?" shows suggestions from the provider
named in `AIRWIZE_ENERGY_OPTIMIZER` (`webapp/services/energy_optimization.py`).

**`rules` (the default)** reuses the Solar outlook's rules-based recommendations
(`webapp/services/recommendations.py`). Both use the same live snapshot and the same
pipeline in `webapp/services/solar_outlook.py`, so the Energy tab and the Solar outlook
card always say the same thing. Only the energy-related rules are offered, matched to
the site type:

| Rule | Shown for |
|---|---|
| Haze is cutting output, clean the panels | Solar site |
| Haze forecast: pre-charge batteries or defer loads in a time window | Solar, battery and generator sites |

Grid connections get none. The air-quality actions (LGU patrols, rice-straw collection,
clean cooking) stay on the Solar outlook card. Each suggestion says what it was based on.
In simulation mode that is the *live* air quality, not the demo scenario, and the
suggestion says so. If the scraper is down, the panel says suggestions are unavailable
rather than showing old or invented ones. Set `AIRWIZE_ENERGY_OPTIMIZER=` (empty) to turn
the panel back into a placeholder that makes no requests.

**To swap in an AI service:**

1. Implement a provider with `suggest(context) -> list[Suggestion]` and a `label`
   attribute (shown as the panel badge) in `webapp/services/energy_optimization.py`.
   Read the API key from an environment variable there, on the server only.
2. Register it in `PROVIDERS`, then start Flask with `AIRWIZE_ENERGY_OPTIMIZER=<name>`.
3. The page sends the context from `dashboard/static/js/lib/energy/context.js` to
   `POST /api/energy/suggestions` and lists the `{title, body, basis}` suggestions it gets back.
   The context holds the site type, mode, scenario, clock, current readings, drain rate,
   outside conditions, forecast and the explanations shown. Its exact schema is in the
   module docstring. A provider can also call `solar_outlook.build_outlook()` to use the
   Solar outlook forecast. The panel's markup does not change.

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
venv/bin/python app.py
```

`--scenario hazy` makes several municipalities exceed 35 µg/m³ with a rising trend;
`--scenario clear` keeps the province clean. Both are for demo rehearsal only and never
contact Plume Labs. The other fake modes are `--mode pending | partial`.

## Known limitations

- Readings live only in the Go scraper's memory, so restarting it means waiting for a new first pass.
- Alert rules are per browser. Notifications fire only while the dashboard tab is open and permission has been granted.
- The forecast chart's morph between municipalities is drawn in JS and works everywhere. The table sparklines morph only in browsers that can transition the CSS `d` property (Chromium, Firefox). Safari swaps them instantly.
- The Switzer font loads from Fontshare. Offline, the page falls back to the system sans-serif.
- Energy tab: no solar Wi-Fi module adapter exists yet, so live mode can't show system readings. The live trend chart only covers readings received while the page is open. Simulation numbers are illustrative.
- Solar generation is synthetic demo data, not a validated photovoltaic model. The two
  forecasters are deliberately small linear regressions; there is no held-out validation
  against real inverter output. The real deliverable is the pipeline, the labelled UI and
  the auditable recommendation rules.
