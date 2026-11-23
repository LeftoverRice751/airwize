/**
 * The Energy tab. Adapts its heading, tiles, explanations and chart to the
 * selected site type (lib/energy/sites.js) and runs in one of two modes:
 *
 *   simulation  a scripted scenario on a demo clock (lib/energy/simulation.js).
 *               Outside conditions are scripted too. Needs no device or Wi-Fi.
 *   live        readings from the solar system's Wi-Fi module via Flask
 *               (lib/energy/live.js). Outside conditions come live from the Go
 *               scraper's snapshot. Values the device does not supply stay empty.
 *
 * Both modes reduce to one "situation" object (see lib/energy/explain.js) that
 * feeds the tiles, the explanations, the chart and the optimization context.
 * app.js calls update() on every render; the demo clock and live polling run
 * only while the tab is open.
 */
import { h } from '../../lib/dom.js'
import { fmtDuration, fmtNumber, fmtOneDecimal, fmtTime, fromUnix } from '../../lib/format.js'
import { levelLabel, rankForIndex } from '../../lib/levels.js'
import { splitForecast } from '../../lib/outlook.js'
import { MODES, SITES, SITE_KEYS, hasStorage, siteFor } from '../../lib/energy/sites.js'
import { SCENARIOS, scenarioFor } from '../../lib/energy/scenarios.js'
import { DemoRun, TICK_MS, scriptedForecast } from '../../lib/energy/simulation.js'
import { LOOKBACK_MIN, explain, quietReason } from '../../lib/energy/explain.js'
import { LiveEnergy, liveDrainRate, liveLoadAgo } from '../../lib/energy/live.js'
import { optimizationContext } from '../../lib/energy/context.js'
import { button } from '../../ui/primitives.js'
import { Segmented } from '../../ui/segmented.js'
import { EnergyTiles } from './energy-tiles.js'
import { EnergyChart } from './energy-chart.js'
import { OptimizationPanel } from './optimization-panel.js'

const CONN_TEXT = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Connection error',
  not_configured: 'Not connected',
}
const num = (v) => typeof v === 'number' && Number.isFinite(v)
const STABLE_PCT_H = 0.5

export class EnergyView {
  constructor(root, { config, onChange }) {
    this.root = root
    this.onChange = onChange
    this.props = null
    this.run = null
    this.timer = null
    const slot = (name) => root.querySelector(`[data-slot="${name}"]`)
    this.s = {
      title: root.querySelector('#energy-title'),
      meta: slot('meta'),
      sim: slot('sim'),
      scenarios: slot('scenarios'),
      desc: slot('scenario-desc'),
      live: slot('live'),
      conn: slot('conn'),
      connText: slot('conn-text'),
      connMessage: slot('conn-message'),
      municipality: slot('municipality'),
      why: slot('why'),
    }

    this.siteSeg = new Segmented({ label: 'Site type', onChange: (site) => onChange({ site }) })
    this.siteSeg.el.setAttribute('aria-labelledby', 'energy-site-label')
    slot('site').append(this.siteSeg.el)
    this.modeSeg = new Segmented({ label: 'Operating mode', onChange: (mode) => onChange({ mode }) })
    this.modeSeg.el.setAttribute('aria-labelledby', 'energy-mode-label')
    slot('mode').append(this.modeSeg.el)

    this.scenarioButtons = new Map(
      SCENARIOS.map((sc) => [
        sc.id,
        h('button', { type: 'button', class: 'btn btn--secondary energy-scenario', 'aria-pressed': 'false', onclick: () => this.pickScenario(sc.id) }, sc.label),
      ]),
    )
    this.s.scenarios.append(...this.scenarioButtons.values())

    this.connectBtn = button({ label: 'Connect', iconName: 'refresh', onClick: () => this.live.connect() })
    slot('connect').append(this.connectBtn)
    this.s.municipality.addEventListener('change', () => onChange({ m: this.s.municipality.value }))

    this.tiles = new EnergyTiles(slot('tiles'))
    this.optimization = new OptimizationPanel({ url: config.energy_suggestions_url, enabled: config.optimization_enabled })
    slot('optimization').replaceWith(this.optimization.el)
    this.chart = new EnergyChart()
    slot('chart').replaceWith(this.chart.el)

    this.live = new LiveEnergy(config.energy_live_url, config.energy_poll_interval_ms, () => this.paint())
  }

  /** Called by app.js on every render. */
  update(props) {
    const prev = this.props
    this.props = props
    const site = siteFor(props.site)
    const scenario = scenarioFor(props.scenario)
    if (!this.run || this.run.site !== site || this.run.scenario !== scenario) this.run = new DemoRun(scenario, site)

    const sim = props.mode !== 'live'
    this.setTimers(props.active && sim, props.active && !sim)
    if (!props.active) return

    if (!prev || prev.site !== props.site || prev.mode !== props.mode) {
      this.siteSeg.update(SITE_KEYS.map((k) => ({ value: k, label: SITES[k].label })), site.key)
      this.modeSeg.update(Object.entries(MODES).map(([value, label]) => ({ value, label })), sim ? 'simulation' : 'live')
    }
    this.paint()
  }

  pickScenario(id) {
    if (id === this.props.scenario) {
      this.run.restart() // clicking the active scenario restarts it
      this.paint()
    } else {
      this.onChange({ scenario: id })
    }
  }

  setTimers(clock, polling) {
    if (clock && !this.timer) {
      this.timer = window.setInterval(() => {
        if (this.run.done) return
        this.run.tick()
        this.paint()
      }, TICK_MS)
    } else if (!clock && this.timer) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    if (polling && !this.live.running) this.live.start()
    else if (!polling && this.live.running) this.live.stop()
  }

  /* ---------- Situation ---------- */

  situation() {
    const p = this.props
    const site = siteFor(p.site)
    return p.mode === 'live' ? this.liveSituation(site) : this.simSituation(site)
  }

  simSituation(site) {
    const run = this.run
    const pt = run.current()
    const o = pt.outside
    const rate = pt.drainPctH
    return {
      site,
      mode: 'simulation',
      scenario: run.scenario,
      storage: hasStorage(site, 'simulation'),
      clock: pt.time,
      readings: { charge_pct: pt.charge, voltage_v: pt.voltage, load_w: pt.load, solar_w: pt.solar, generator_w: pt.generator },
      drain: rate === null ? null : drainInfo(rate, pt.charge),
      previousLoadW: run.ago(LOOKBACK_MIN)?.load ?? null,
      outside: { ...o, level: levelLabel(rankForIndex(o.plume_index)).toLowerCase(), source: 'scripted' },
      forecast: scriptedForecast(run.scenario, run.minute, pt.time),
      history: run.history().map((x) => ({ time: x.time, charge_pct: x.charge, load_w: x.load })),
      range: [run.points[0].time, run.points.at(-1).time],
    }
  }

  liveSituation(site) {
    const l = this.live.state
    const r = l.reading
    const readings = {
      charge_pct: r?.charge_pct ?? null,
      voltage_v: r?.voltage_v ?? null,
      load_w: r?.load_w ?? null,
      solar_w: r?.solar_w ?? null,
      generator_w: r?.generator_w ?? null,
    }
    const storage = hasStorage(site, 'live', r)
    const rate = r && storage ? liveDrainRate(l.history) : null
    const m = this.outsideMunicipality()
    const times = l.history.map((x) => x.time)
    return {
      site,
      mode: 'live',
      scenario: null,
      storage,
      clock: new Date(),
      readings,
      drain: !storage || !r ? null : rate === null ? { state: 'unknown', ratePctH: null, hoursLeft: null } : drainInfo(rate, readings.charge_pct),
      previousLoadW: r ? liveLoadAgo(l.history, LOOKBACK_MIN) : null,
      outside: m
        ? {
            municipality: m.city,
            temperature_c: m.weather?.temperature,
            uv: m.weather?.uv,
            plume_index: m.plume_index,
            level: m.level,
            source: 'live',
          }
        : null,
      forecast: m
        ? splitForecast(m)
            .future.slice(0, 6)
            .map((f) => ({ timestamp: fromUnix(f.timestamp).getTime(), temperature_c: f.weather?.temperature, uv: f.weather?.uv, plume_index: f.plume_index }))
        : [],
      history: l.history,
      range: times.length >= 2 ? [times[0], times.at(-1)] : null,
    }
  }

  /** The municipality whose live conditions the Energy tab uses: the one selected on the monitor, else the first. */
  outsideMunicipality() {
    const data = this.props.data
    if (!data?.length) return null
    return data.find((m) => m.city === this.props.city) ?? [...data].sort((a, b) => a.city.localeCompare(b.city))[0]
  }

  /* ---------- Render ---------- */

  paint() {
    if (!this.props?.active) return
    const s = this.situation()
    const sim = s.mode === 'simulation'

    this.s.title.textContent = s.site.heading
    this.renderMeta(s)

    // Simulation controls only in simulation mode; connection panel only in live mode.
    this.s.sim.hidden = !sim
    this.s.live.hidden = sim
    if (sim) {
      for (const [id, b] of this.scenarioButtons) b.setAttribute('aria-pressed', String(id === s.scenario.id))
      const end = this.run.done ? ' Finished: click it again to replay.' : ''
      const text = `${s.scenario.description}${end}`
      if (this.s.desc.textContent !== text) this.s.desc.textContent = text
    } else {
      this.renderConnection()
    }

    this.tiles.update(tilesFor(s, this.props, this.live.state))

    const explanations = explain(s)
    this.renderWhy(s, explanations)

    const kind = s.storage ? 'charge' : 'load'
    const key = kind === 'charge' ? 'charge_pct' : 'load_w'
    this.chart.update({
      kind,
      mode: s.mode,
      points: s.history.map((x) => ({ time: x.time, value: x[key] })),
      range: s.range,
      empty: sim
        ? 'The scenario has just started.'
        : this.live.state.state === 'connected'
          ? `Waiting for a second reading from the solar system to draw the ${kind === 'charge' ? 'stored-energy' : 'load'} trend.`
          : 'No live readings to chart. Connect a solar system to see its trend.',
    })

    this.optimization.update(optimizationContext(s, explanations), `${s.site.key}|${s.mode}|${s.scenario?.id ?? ''}`)
  }

  renderMeta(s) {
    const sim = s.mode === 'simulation'
    const l = this.live.state
    const rows = [
      ['Site type', s.site.label],
      ['Mode', MODES[s.mode]],
      ['Data source', sim ? `Scripted scenario: ${s.scenario.label}` : (l.source ?? 'No solar system connected')],
      sim ? ['Demo clock', `${fmtTime(s.clock)}${this.run.done ? ' (finished)' : ''}`] : ['Solar system', CONN_TEXT[l.state]],
      ['Outside conditions', sim ? 'Scripted' : s.outside ? `Live, Plume Labs via the Go scraper` : 'Live, not available yet'],
    ]
    const sig = JSON.stringify(rows.map((r) => r[0]))
    if (this.metaSig !== sig) {
      this.metaSig = sig
      this.metaDd = rows.map(() => h('dd'))
      this.s.meta.replaceChildren(...rows.map((r, i) => h('div', { class: 'energy-meta__item' }, h('dt', {}, r[0]), this.metaDd[i])))
    }
    rows.forEach((r, i) => {
      if (this.metaDd[i].textContent !== r[1]) this.metaDd[i].textContent = r[1]
    })
    this.s.meta.dataset.mode = s.mode
  }

  renderConnection() {
    const l = this.live.state
    this.s.conn.dataset.state = l.state
    this.s.connText.textContent = CONN_TEXT[l.state]
    const msg =
      l.state === 'connected'
        ? `Receiving readings from ${l.source}. Last reading at ${fmtTime(l.history.at(-1)?.time ?? l.checkedAt)}.`
        : l.state === 'connecting'
          ? 'Asking the dashboard server for a reading from the solar system…'
          : l.state === 'idle'
            ? 'Not connected yet.'
            : (l.message ?? 'The solar system is not connected.')
    this.s.connMessage.textContent = msg
    this.s.connMessage.dataset.state = l.state
    this.connectBtn.lastChild.textContent = l.state === 'connected' ? 'Refresh' : l.state === 'idle' || l.state === 'not_configured' ? 'Connect' : 'Try again'
    this.connectBtn.disabled = l.state === 'connecting'

    // Municipality picker for live outside conditions (from the Go scraper).
    const data = this.props.data
    const sel = this.s.municipality
    const names = data ? [...data].map((m) => m.city).sort((a, b) => a.localeCompare(b)) : []
    const sig = names.join('|')
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig
      sel.replaceChildren(...(names.length ? names.map((n) => h('option', { value: n }, n)) : [h('option', { value: '' }, 'Air quality readings unavailable')]))
    }
    sel.disabled = !names.length
    const current = this.outsideMunicipality()
    if (current && sel.value !== current.city) sel.value = current.city
  }

  /** Keyed by explanation id: text updates in place, only new causes animate in. */
  renderWhy(s, explanations) {
    const list = explanations.length ? explanations : [{ id: 'quiet', text: quietReason(s), basis: null }]
    const sig = list.map((e) => e.id).join('|')
    if (sig !== this.whySig) {
      this.whySig = sig
      const old = this.whyItems ?? new Map()
      this.whyItems = new Map()
      for (const e of list) {
        const item = old.get(e.id) ?? {
          text: h('p'),
          basis: h('p', { class: 'energy-why__basis' }),
        }
        if (!item.el) {
          item.el = h('li', { class: `energy-why__item is-new${e.id === 'quiet' ? ' energy-why__item--quiet' : ''}`, onanimationend: (ev) => ev.currentTarget.classList.remove('is-new') }, item.text, item.basis)
        }
        this.whyItems.set(e.id, item)
      }
      this.s.why.replaceChildren(...[...this.whyItems.values()].map((i) => i.el))
    }
    for (const e of list) {
      const item = this.whyItems.get(e.id)
      if (item.text.textContent !== e.text) item.text.textContent = e.text
      item.basis.hidden = !e.basis
      if (e.basis) item.basis.textContent = `Estimate based on ${e.basis.join(', ')}`
    }
  }
}

function drainInfo(rate, charge) {
  if (rate > STABLE_PCT_H) return { state: 'draining', ratePctH: rate, hoursLeft: num(charge) ? charge / rate : null }
  if (rate < -STABLE_PCT_H) return { state: 'charging', ratePctH: rate, hoursLeft: null }
  return { state: 'stable', ratePctH: rate, hoursLeft: null }
}

/** Which tiles apply for this site and mode, and what each shows. */
function tilesFor(s, props, live) {
  const sim = s.mode === 'simulation'
  const r = s.readings
  const tag = sim ? 'Simulated' : 'Live'
  const tagMode = sim ? 'simulation' : 'live'
  const noLive = live.state === 'connected' ? 'Not reported by the device' : 'No reading: solar system not connected'
  const missing = (id, label) => ({ id, label, value: '—', detail: noLive, tag, tagMode, tone: 'missing' })
  const tiles = []

  if (s.storage) {
    tiles.push(
      num(r.charge_pct)
        ? { id: 'storage', label: 'Stored energy', value: `${Math.round(r.charge_pct)}`, unit: '%', detail: num(r.voltage_v) ? `${fmtOneDecimal(r.voltage_v)} V` : 'Voltage not reported', tag, tagMode }
        : missing('storage', 'Stored energy'),
    )
    const d = s.drain
    if (!d) tiles.push(missing('trend', 'Draining'))
    else if (d.state === 'unknown') tiles.push({ id: 'trend', label: 'Trend', value: '—', detail: 'Needs a few minutes of charge readings', tag, tagMode, tone: 'missing' })
    else if (d.state === 'draining')
      tiles.push({
        id: 'trend',
        label: 'Draining',
        value: fmtOneDecimal(d.ratePctH),
        unit: '%/h',
        detail: num(d.hoursLeft) ? `About ${fmtDuration(d.hoursLeft)} left at this rate` : 'Time left unknown',
        tag,
        tagMode,
      })
    else tiles.push({ id: 'trend', label: 'Trend', value: 'Stable', detail: d.state === 'charging' ? `Charging at ${fmtOneDecimal(-d.ratePctH)} %/h` : 'Not draining', tag, tagMode })
  }

  tiles.push(num(r.load_w) ? { id: 'load', label: 'Load', value: fmtNumber(r.load_w), unit: 'W', detail: 'Drawn by appliances now', tag, tagMode } : missing('load', 'Load'))

  if (s.site.source === 'solar') {
    tiles.push(
      num(r.solar_w)
        ? { id: 'source', label: 'Solar', value: fmtNumber(r.solar_w), unit: 'W', detail: r.solar_w < 20 ? 'Panels not producing' : 'Supplied by the panels', tag, tagMode }
        : missing('source', 'Solar'),
    )
  } else if (s.site.source === 'generator') {
    tiles.push(
      num(r.generator_w)
        ? { id: 'source', label: 'Generator', value: r.generator_w > 0 ? fmtNumber(r.generator_w) : 'Off', unit: r.generator_w > 0 ? 'W' : '', detail: r.generator_w > 0 ? 'Supplied by the generator' : sim ? 'Starts automatically below 35% charge' : 'Generator not running', tag, tagMode }
        : missing('source', 'Generator'),
    )
  }

  const o = s.outside
  if (o && num(o.temperature_c)) {
    const level = num(o.plume_index) ? levelLabel(rankForIndex(o.plume_index)) : 'Unknown'
    tiles.push({
      id: 'outside',
      label: 'Outside',
      value: `${Math.round(o.temperature_c)}`,
      unit: '°C',
      detail: `${o.municipality} · UV ${num(o.uv) ? Math.round(o.uv) : 'n/a'} · ${level} air${num(o.plume_index) ? ` (${Math.round(o.plume_index)})` : ''}`,
      tag: sim ? 'Scripted' : 'Live',
      tagMode: sim ? 'simulation' : 'live',
    })
  } else {
    tiles.push({
      id: 'outside',
      label: 'Outside',
      value: '—',
      detail: props.airStatus === 'loading' ? 'Waiting for air quality readings' : 'Air quality readings are unavailable',
      tag: 'Live',
      tagMode: 'live',
      tone: 'missing',
    })
  }
  return tiles
}
