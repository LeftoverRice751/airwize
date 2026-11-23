# Airwize demo script

Target length: 4–5 minutes, with a 30-second opening. The whole demo runs on
one page; no slides, no second app.

## 30-second problem statement

> Laguna burns rice straw and household waste, and the haze it produces does
> more than raise the air-quality index. It also settles on solar panels and
> cuts the power they make — exactly when the grid needs that power most. Today
> an LGU can see the AQI and can see a solar forecast, but not the link between
> them. Airwize puts both on one screen, using live Plume Labs PM2.5, a clearly
> labelled synthetic rooftop array, and two forecasts: one that ignores air
> quality and one that does not. The gap between the two lines is the decision
> support — clean the panels, pre-charge, or send a patrol.

## Before you present

1. Check the app is up (see `README.md`):
   - Go scraper: `cd webscraper && go run . -serve :8080 -interval 5m`
   - Flask: `python app.py`
2. Open <http://127.0.0.1:5000> and confirm the solar card shows a current value
   and two chart lines.
3. If the live scraper is flaky, rehearse with the offline fixture:
   ```bash
   python -m tests.fake_scraper --scenario hazy     # 6 municipalities in a haze event
   python -m tests.fake_scraper --scenario clear    # clean-air contrast
   ```
   Restart Flask only if you change `AIRWIZE_SCRAPER_URL`.
4. Keep the two screenshots at the bottom of this file open in a second window.

## Live walkthrough (4 minutes)

### 1. The AQI card (45 s)

- Start at the top. The province strip shows the next-24-hour peak, the mean
  change against yesterday, and any alerts. "Bay, 120, unhealthy" is the hook.
- Click **Bay**. In the detail panel point out:
  - the current level and Plume Labs' advice;
  - the 48-hour chart (past solid, forecast dashed), all in Manila time;
  - **Driving pollutant: PM2.5** — this is the pollutant the solar model uses.
- Say: "This is live Plume Labs data, scraped by the Go service every five
  minutes. Everything on this part of the screen is real."

### 2. The solar card (45 s)

- Open **Outlook** in the side navigation and point at the **Solar outlook** card.
- Point at the **Synthetic solar data** badge and the source line before anyone
  asks: "AQI: Plume Labs (live) · Solar: synthetic demo data".
- Read the current output and the site: a 5 kW demo array attached to the
  worst-reading municipality. The card defaults to the **Demo** clock, starting
  at the first daylight frame; it cycles through the day so output, note and
  advice move. Switch to **Live** for the current snapshot. At night, live mode
  honestly reads 0.0 kW.
- Explain the model in one sentence: half-sine daylight, deterministic clouds,
  and PM2.5 attenuation `clamp(1 − 0.002 × PM2.5, 0.6, 1.0)`.

### 3. The divergence chart (60 s)

- The grey dashed line is the weather-only baseline. The green line is the
  AQI-aware forecast. Same array, same clouds — only the pollution input differs.
- On the hazy fixture the two lines separate through the middle of the day.
  Read the note under the chart: **"Haze expected — AQI-aware forecast is up to
  roughly 20% lower than weather-only."** The exact percentage is computed from
  the current forecast.
- Switch to the clear fixture (`--scenario clear`) and restart the fake: the page
  reconnects automatically, the lines sit on top of each other, and the note flips
  to **"Air quality is not expected to reduce solar output significantly."** That
  contrast is the product.
- If asked why the forecast is linear regression on 48 hours of paired data:
  "It is deliberately small and inspectable. The deliverable is the pipeline
  and the decision, not a claim of photovoltaic accuracy."

### 4. The advisor plan (60 s)

- Stay on the hazy fixture. The **Recommended actions** panel shows at most
  three grounded suggestions, warnings first:
  - **Solar / Warning** — panel cleaning, with the estimated recovery in
    kWh/day, the cleanest daylight window and a haze-season cadence. Evidence
    lists the municipalities driving the haze.
  - **Solar / Advice** — pre-charge the battery or move loads out of the worst
    three-hour window.
  - **Air quality / Advice** — during a harvest month, centralized rice-straw
    collection, citing the Pila facility precedent.
- Say: "The smart planner computes the kWh loss and the windows locally. If an
  AI model is configured, it only rewrites and reorders those grounded actions;
  it cannot invent a number. Every suggestion keeps its evidence."
- The badge says **Smart plan** without a model, or **AI advisor** when
  `AIRWIZE_AI_API_KEY` is configured.

### 5. Close (30 s)

- One sentence: "The AQI is real, the solar generation is a labelled demo, and
  the forecasting and recommendation pipeline is the deliverable."
- Then the honesty line, verbatim (below).

## The honesty line — say it verbatim

> "AQI is real Plume Labs data; solar generation is synthetic for the demo; the
> forecasting and recommendation pipeline is the real deliverable."

Do not bury this. It buys more credibility than any accuracy claim.

## Backup screenshots

Use these if the network, the scraper, or the projector fails. Both were
captured from the offline fixture with animations disabled (reduced-motion) so
they show the settled state.

### Hazy day — divergence, cleaning warning, straw-collection advice

![Hazy day: AQI card showing unhealthy PM2.5, and the solar card showing the AQI-aware line below the weather-only baseline with a panel-cleaning warning and rice-straw advice.](screenshots/hazy-day.png)

### Clear day — lines overlap, no action recommended

![Clear day: fair air quality and the solar card's two forecast lines overlapping, with the note that air quality is not expected to reduce output.](screenshots/clear-day.png)

## If something breaks

| Symptom | Recovery |
|---|---|
| `Readings are unavailable` banner | The Go scraper is down. Start it and use the notice's **Try again** (or reload the page). If it stays down, switch to `python -m tests.fake_scraper` and keep presenting on the fixture (say so). |
| Solar card says "first pass may still be running" | The scraper has not completed its first pass. Wait ~30 s; the card retries by itself every 15 s. |
| Chart is flat or current output is 0 | It is night in Manila. Use the hazy screenshot above, or run the demo during daylight. |
| Lines do not diverge on a hazy day | Check that the municipality with the highest PM2.5 has PM2.5 in the snapshot and that the forecast series varies. The card marks `degraded` when PM2.5 is missing. |
| Projector shows the old page | Hard refresh (`Ctrl+Shift+R`). Static assets are served by Flask; no build step. |

## Anticipated questions

- **Is the solar data real?** No. It is generated from a documented formula and
  labelled synthetic in the badge, the card heading, the source line and the
  API payload (`"synthetic": true`).
- **Why a synthetic array instead of a real inverter?** One day, no hardware
  access, and the goal is the pipeline. A real inverter feed can replace
  `synthetic_generation` without changing the endpoint or the UI contract.
- **Why does the baseline predict lower than the actual synthetic output?** The
  baseline is a linear model fitted on a 48-hour window; it is a comparison
  signal, not a physics engine. The current kW reading is the direct synthetic
  value.
- **What would you validate next?** Held-out generation data from a real
  rooftop, a non-linear model, and a lag between PM2.5 and panel soiling rather
  than instantaneous attenuation.
- **Is the advisor really AI?** The default is a deterministic smart planner, so
  the demo works offline and every number is reproducible. Set
  `AIRWIZE_AI_API_KEY` (and optionally `AIRWIZE_AI_MODEL`) to let an
  OpenAI-compatible model rewrite and prioritise the same grounded actions.
  The badge changes to **AI advisor**; failures fall back to the planner.
- **Where do the recommendation thresholds come from?** `AIRWIZE_PM25_HIGH`
  (35 µg/m³) and `AIRWIZE_PM25_CRITICAL` (75 µg/m³) are configurable; the
  cleaning and pre-charge windows come from the 24-hour forecast, and the
  maintenance cadence from the peak PM2.5.
