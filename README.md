# Airwize

Live air quality, 24-hour forecasts and threshold alerts for the municipalities
of one Philippine province (Laguna by default), from Plume Labs.

Two services work together:

| Service | Language | Job |
|---|---|---|
| `webscraper/` | Go | Scrapes Plume Labs concurrently every 5 minutes and serves the latest snapshot at `GET /api/readings`. The **only** component that talks to Plume Labs. |
| `web.py` + `webapp/` + `dashboard/` | Python / Flask | Serves the dashboard and proxies `/api/readings` from the Go scraper unchanged. |

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
- Python 3.12: `python3 --version`

### 1. One-time setup

The project's `venv/` already has Flask installed. Skip this step unless `venv/` is
missing, for example on a fresh clone:

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

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
| `AIRWIZE_POLL_INTERVAL_MS` | `60000` | How often the browser refreshes readings |
| `AIRWIZE_HOST` / `AIRWIZE_PORT` | `127.0.0.1` / `5000` | Where `python web.py` listens |

Example: `AIRWIZE_SCRAPER_URL=http://10.0.0.5:9000 venv/bin/python web.py`

## Architecture

```
web.py                         entry point: create_app() and app.run()
config.py                      all settings (env-overridable)
requirements.txt               Flask only; everything else is the standard library
webapp/
  __init__.py                  app factory; points Flask at dashboard/templates and dashboard/static
  routes/pages.py              GET /             renders the dashboard page
  routes/api.py                GET /api/readings  proxy to the Go scraper
  services/readings_client.py  urllib client for the scraper, with an explicit timeout
dashboard/                     all front-end code (see dashboard/README.md)
  templates/                   Jinja: index.html + partials (top bar, icon sprite)
  static/css/                  design tokens, base, app styles, motion
  static/js/                   ES modules, no build step
webscraper/                    Go scraper (unchanged)
tests/                         unittest suite + fake scraper + fixture
```

**The proxy.** `GET /api/readings` forwards the Go scraper's body byte for byte, so the
JSON schema is exactly `Snapshot` in `webscraper/main.go`. When the scraper can't be
reached it answers `502`, or `504` on timeout, with `{"error": "..."}`. The dashboard
then shows "Readings are unavailable". If it already had data, it keeps showing that
data with a "Some readings may be out of date" note. Flask does no scraping, parsing,
filtering or server-side polling.

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
venv/bin/python -m tests.fake_scraper            # also: --mode pending | partial
venv/bin/python web.py
```

## Known limitations

- Readings live only in the Go scraper's memory, so restarting it means waiting for a new first pass.
- Alert rules are per browser. Notifications fire only while the dashboard tab is open and permission has been granted.
- The forecast chart's morph between municipalities is drawn in JS and works everywhere. The table sparklines morph only in browsers that can transition the CSS `d` property (Chromium, Firefox). Safari swaps them instantly.
- The Switzer font loads from Fontshare. Offline, the page falls back to the system sans-serif.
