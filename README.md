# Airwize

Live air quality, 24-hour forecasts and threshold alerts for the municipalities
of one Philippine province (Laguna by default), from Plume Labs.

Two services work together:

| Service | Language | Job |
|---|---|---|
| `webscraper/` | Go | Scrapes Plume Labs concurrently every 5 minutes, serves `GET /api/readings`, and broadcasts `WS /ws/readings`. The **only** component that talks to Plume Labs. |
| `web.py` + `webapp/` + `dashboard/` | Python / Flask | Serves the dashboard and keeps `/api/readings` as a manual HTTP fallback. |

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

It scans Plume Labs, refreshes every 5 minutes, serves the current snapshot at
<http://localhost:8080/api/readings>, and pushes snapshots to WebSocket clients
at `ws://localhost:8080/ws/readings`. Leave it running.

### 3. Start the Flask dashboard (terminal 2, from the project root)

```bash
venv/bin/python web.py
```

If you activated the venv first (`source venv/bin/activate`), `python web.py` is enough.
For development with auto-reload, use `venv/bin/flask --app web run --debug`.

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
AIRWIZE_SCRAPER_URL=http://localhost:9000 venv/bin/python web.py

# Public WebSocket address (needed when SCRAPER_URL is private or proxied)
AIRWIZE_WEBSOCKET_URL=wss://air.example.com/ws/readings venv/bin/python web.py

# Dashboard on another port, or reachable from your local network
AIRWIZE_PORT=8000 venv/bin/python web.py
AIRWIZE_HOST=0.0.0.0 venv/bin/python web.py

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
webscraper/                    Go scraper, HTTP snapshot and WebSocket broadcast
tests/                         unittest suite + fake scraper + fixture
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
