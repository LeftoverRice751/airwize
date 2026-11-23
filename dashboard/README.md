# Laguna air dashboard (front end)

Jinja templates, CSS and plain browser JavaScript (ES modules), served by the
Flask app in `../webapp`. There is no Node toolchain and no build step: edit a
file and reload. See the root `README.md` for how to run everything.

## Structure

- `templates/index.html` is the page shell: view headings, empty slots the JS fills, the footer, and the inline pre-paint theme script.
<<<<<<< HEAD
- `templates/partials/topbar.html` is the header (nav, live status, refresh, search, theme, mobile sheet). `features/topbar.js` wires it up.
- `templates/partials/solar_card.html` is the solar outlook + recommendations section included at the end of the monitor view. `static/js/solar.js` polls `/api/solar-forecast` and fills its two slots.
=======
- `templates/partials/topbar.html` is the header and off-canvas navigation sidebar (live WebSocket status, search and theme controls). `features/topbar.js` wires it up.
>>>>>>> 5a4dc0d4d786c952be36c5004444c01688e3dcee
- `templates/partials/icons.html` holds the SVG icon sprite, defined once. Use `{{ icon('name') }}` in Jinja and `icon('name')` in JS.
- `static/css/`
  - `tokens.css` has every colour, font, space and radius, for the light and dark themes. Components never use literal values.
  - `base.css` has the reset, typography and the reduced-motion rule.
  - `app.css` holds the component styles, carried over from the React version.
  - `motion.css` has the transitions and keyframes that replace the `motion` library, plus the single sliding indicators (nav, segmented control, table marker, palette highlight).
  - `solar.css` holds the solar card, its two-line chart and the recommendation list styles.
- `static/js/`
  - `app.js` is the entry point. It owns one state object, derives rows/selection/triggered rules from it, and hands each component its props. `set({...})` batches a render.
  - `lib/` holds logic with no UI: `readings.js` (WebSocket updates plus HTTP fallback), `url-state.js`, `levels.js` (severity bands), `outlook.js` (forecast analysis), `alerts.js` (rules, localStorage, evaluation), `theme.js`, `format.js`, `motion.js` (springs and FLIP), `dom.js` (the `h()` element helper).
  - `ui/` holds reusable pieces: `primitives.js` (button, notice, level badge), `segmented.js`, `ticker.js`, `toast.js`, `palette.js` (Ctrl/Cmd+K or `/`), `alert-trigger.js`.
  - `features/` holds screen sections: `topbar.js`, `province-strip.js`, `municipality-table.js`, `sparkline.js`, `detail-panel.js`, `forecast-chart.js`, `alerts-view.js`.
  - `solar.js` is the solar outlook card: its own poller (same 60 s interval), a self-contained two-line SVG chart, the plain-language haze note, and the top-three recommendations.

## Conventions

Each component is a class that builds its DOM once and exposes `update(props)`, which
changes only what differs. That keeps focus, number tickers, chart morphs and row
slides intact across real-time snapshot updates. Every animation respects
`prefers-reduced-motion`: CSS through the rule in `base.css`, JS springs through
`reducedMotion()`.
