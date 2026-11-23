/**
 * Solar outlook card. Polls GET /api/solar-forecast (same interval as the
 * readings) and draws the baseline vs AQI-aware forecast with a plain-language
 * note. Recommendations come from the server's grounded advisor: a smart plan
 * computed from AQI, optionally rewritten by an LLM when one is configured.
 *
 * A built-in demo clock cycles the server's hourly simulation frames so the
 * card is useful at night (when the live array is at 0 kW), showing the output,
 * note and advisor advice move through the day. Switch to Live for the current
 * snapshot.
 *
 * The generation behind this card is synthetic demo data; PM2.5 is live Plume
 * Labs data forwarded by the Go scraper. Nothing here estimates real inverter
 * output.
 */
import { cx, h, s, skeleton } from './lib/dom.js'
import { fmtTime, localHour } from './lib/format.js'
import { button, notice } from './ui/primitives.js'
import { Segmented } from './ui/segmented.js'

const H = 170
const PAD = { top: 10, right: 10, bottom: 24, left: 34 }
const RETRY_MS = 15_000
const DEMO_TICK_MS = 1_200

const fmtKw = (value) => `${Number(value ?? 0).toFixed(1)}`
const fmtPm = (value) => (value === null || value === undefined ? 'n/a' : `${Number(value).toFixed(1)} µg/m³`)

/** Round the y-axis ceiling to a half-kilowatt step. */
function niceMax(value) {
  return Math.max(1, Math.ceil(value * 2) / 2)
}

class SolarChart {
  constructor() {
    this.points = []
    this.active = null
    this.width = 0

    this.grid = s('g', { class: 'solar-chart__grid' })
    this.baseline = s('path', { class: 'solar-chart__baseline' })
    this.aqi = s('path', { class: 'solar-chart__aqi' })
    this.ticks = s('g', { class: 'solar-chart__ticks' })
    this.nowLine = s('line', { class: 'solar-chart__now', y1: PAD.top, y2: H - PAD.bottom, x1: 0, x2: 0 })
    this.nowDot = s('circle', { class: 'solar-chart__now-dot', r: 3.5, cx: 0, cy: 0 })
    this.svg = s(
      'svg',
      {
        height: H,
        role: 'img',
        'aria-label': 'Hourly synthetic solar output for the next 24 hours: weather-only baseline versus AQI-aware forecast, with the demo clock marker.',
      },
      this.grid,
      this.baseline,
      this.aqi,
      this.ticks,
      this.nowLine,
      this.nowDot,
    )

    this.el = h(
      'figure',
      { class: 'solar-chart' },
      this.svg,
      h(
        'figcaption',
        { class: 'solar-chart__legend' },
        h('span', { class: 'solar-chart__key' }, h('span', { class: 'solar-chart__swatch solar-chart__swatch--baseline' }), 'Weather-only'),
        h('span', { class: 'solar-chart__key' }, h('span', { class: 'solar-chart__swatch solar-chart__swatch--aqi' }), 'AQI-aware'),
      ),
    )

    new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width)
      if (!width || width === this.width) return
      this.width = width
      this.draw()
    }).observe(this.el)
  }

  update(points, active = null) {
    this.points = Array.isArray(points) ? points : []
    this.active = active
    this.draw()
  }

  draw() {
    const points = this.points
    if (points.length < 2 || !this.width) return
    const w = this.width
    const values = points.flatMap((p) => [Number(p.baseline_kw) || 0, Number(p.aqi_kw) || 0])
    const max = niceMax(Math.max(...values))
    const x = (i) => PAD.left + (i / (points.length - 1)) * (w - PAD.left - PAD.right)
    const y = (v) => PAD.top + (1 - Math.max(0, v) / max) * (H - PAD.top - PAD.bottom)
    const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(p[key]) || 0).toFixed(1)}`).join('')

    this.svg.setAttribute('width', w)
    this.svg.setAttribute('viewBox', `0 0 ${w} ${H}`)
    this.baseline.setAttribute('d', path('baseline_kw'))
    this.aqi.setAttribute('d', path('aqi_kw'))

    const lines = []
    for (const value of [0, max / 2, max]) {
      const yy = y(value)
      lines.push(s('line', { x1: PAD.left, x2: w - PAD.right, y1: yy, y2: yy }))
      lines.push(s('text', { x: PAD.left - 7, y: yy, dy: '0.32em', 'text-anchor': 'end' }, value.toFixed(1)))
    }
    this.grid.replaceChildren(...lines)

    // One tick every six hours keeps the axis readable at narrow widths.
    const ticks = points
      .map((p, i) => ({ p, i, date: new Date(p.timestamp) }))
      .filter(({ date }) => localHour(date) % 6 === 0)
      .map(({ date, i }) =>
        s('text', { class: 'solar-chart__tick', x: x(i), y: H - 6, 'text-anchor': 'middle' }, fmtTime(date)),
      )
    this.ticks.replaceChildren(...ticks)

    const active = Number.isInteger(this.active) && points[this.active] ? this.active : null
    const shown = active !== null
    this.nowLine.style.display = shown ? '' : 'none'
    this.nowDot.style.display = shown ? '' : 'none'
    if (shown) {
      const xx = x(active)
      this.nowLine.setAttribute('x1', xx)
      this.nowLine.setAttribute('x2', xx)
      this.nowDot.setAttribute('cx', xx)
      this.nowDot.setAttribute('cy', y(Number(points[active].aqi_kw) || 0))
    }
  }
}

/** Client-side plain-language note, exactly as specified in the plan. */
function noteFor(forecast) {
  // Night rows have delta 0 by construction; including them would make the
  // horizon maximum 0 and the haze message unreachable.
  const daylight = (forecast ?? []).filter((row) => Number(row.baseline_kw) > 0)
  const source = daylight.length ? daylight : (forecast ?? [])
  const deltas = source.map((row) => Number(row.delta_pct)).filter(Number.isFinite)
  if (!deltas.length) return null
  const maxDelta = Math.max(...deltas)
  if (maxDelta < -5) {
    const worst = Math.min(...deltas)
    return {
      hazy: true,
      text: `Haze expected — AQI-aware forecast is up to ${Math.round(Math.abs(worst))}% lower than weather-only.`,
    }
  }
  return { hazy: false, text: 'Air quality is not expected to reduce solar output significantly.' }
}

function evidenceLine(evidence) {
  const places = evidence?.municipalities
  if (!Array.isArray(places) || !places.length) return null
  const shown = places.slice(0, 3).join(', ')
  const more = places.length > 3 ? ` +${places.length - 3} more` : ''
  return `Triggered by PM2.5 in ${shown}${more}.`
}

function renderRecommendations(items) {
  if (!Array.isArray(items) || !items.length) {
    return h('p', { class: 'source-note' }, 'No actions recommended right now.')
  }
  const rank = { warn: 0, info: 1 }
  const sorted = [...items].sort((a, b) => (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2)).slice(0, 3)
  return h(
    'ul',
    { class: 'recs' },
    ...sorted.map((item) =>
      h(
        'li',
        { class: cx('rec', `rec--${item.severity}`) },
        h(
          'div',
          { class: 'rec__head' },
          h('span', { class: 'rec__tag' }, item.category === 'solar' ? 'Solar' : 'Air quality'),
          h('span', { class: cx('rec__sev', `rec__sev--${item.severity}`) }, item.severity === 'warn' ? 'Warning' : 'Advice'),
        ),
        h('p', { class: 'rec__text' }, item.text),
        evidenceLine(item.evidence) && h('p', { class: 'rec__evidence' }, evidenceLine(item.evidence)),
      ),
    ),
  )
}

export class SolarCard {
  constructor(root, url, intervalMs) {
    this.root = root
    this.url = url || '/api/solar-forecast'
    this.intervalMs = intervalMs || 60_000
    this.body = root.querySelector('[data-slot="solar-body"]')
    this.recs = root.querySelector('[data-slot="solar-recs"]')
    this.recsHint = root.querySelector('[data-slot="solar-recs-hint"]')
    this.chart = new SolarChart()
    this.state = { status: 'loading', data: null, error: null }
    this.mode = 'demo'
    this.frames = []
    this.frame = 0
    this.inflight = false
    this.retry = null
    this.timer = null
    this.demoTimer = null

    this.modeSeg = new Segmented({ label: 'Outlook clock', size: 'sm', onChange: (mode) => this.setMode(mode) })
    const modeSlot = root.querySelector('[data-slot="solar-mode"]')
    if (modeSlot) modeSlot.append(this.modeSeg.el)
    this.modeSeg.update(
      [
        { value: 'demo', label: 'Demo' },
        { value: 'live', label: 'Live' },
      ],
      this.mode,
    )

    this.render()
  }

  start() {
    void this.load()
    this.timer = window.setInterval(() => void this.load(), this.intervalMs)
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    this.render()
  }

  /** First daylight frame; at night the demo would otherwise open at 0 kW. */
  firstDaylightFrame() {
    const index = this.frames.findIndex((frame) => Number(frame.current_kw) > 0.05)
    return index >= 0 ? index : 0
  }

  currentFrame() {
    return this.mode === 'demo' && this.frames.length ? this.frames[this.frame] : null
  }

  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.modeSeg.update(
      [
        { value: 'demo', label: 'Demo' },
        { value: 'live', label: 'Live' },
      ],
      this.mode,
    )
    if (this.mode === 'demo') {
      this.frame = this.firstDaylightFrame()
      this.startDemo()
    } else {
      this.stopDemo()
    }
    this.render()
  }

  startDemo() {
    this.stopDemo()
    if (this.frames.length < 2) return
    this.demoTimer = window.setInterval(() => {
      this.frame = (this.frame + 1) % this.frames.length
      this.render()
    }, DEMO_TICK_MS)
  }

  stopDemo() {
    if (this.demoTimer) window.clearInterval(this.demoTimer)
    this.demoTimer = null
  }

  async load() {
    if (this.inflight) return
    this.inflight = true
    try {
      const res = await fetch(this.url, { cache: 'no-store', headers: { Accept: 'application/json' } })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `The solar forecast answered ${res.status}.`)
      if (!data || !Array.isArray(data.forecast)) throw new Error('The solar forecast returned an unexpected payload.')
      window.clearTimeout(this.retry)
      this.retry = null
      this.frames = Array.isArray(data.simulation) ? data.simulation : []
      if (this.mode === 'demo' && this.frames.length) {
        this.frame = this.firstDaylightFrame()
        this.startDemo()
      } else if (this.mode === 'live') {
        this.stopDemo()
      }
      this.set({ status: 'ready', data, error: null })
    } catch (error) {
      this.stopDemo()
      this.set({ status: 'error', error: error instanceof TypeError ? 'The dashboard server could not be reached.' : error.message })
      // The scraper's first pass can still be running; try again soon without
      // waiting for the full polling interval.
      window.clearTimeout(this.retry)
      this.retry = window.setTimeout(() => {
        this.retry = null
        void this.load()
      }, RETRY_MS)
    } finally {
      this.inflight = false
    }
  }

  render() {
    const { status, data, error } = this.state

    if (status === 'ready' && data) {
      const frame = this.currentFrame()
      const advisor = frame?.advisor ?? data.advisor
      this.renderReady(data, frame)
      this.recs.replaceChildren(renderRecommendations(frame?.recommendations ?? data.recommendations))
      if (this.recsHint) {
        this.recsHint.textContent = this.mode === 'demo' ? `Demo · ${advisor?.label ?? 'Smart plan'}` : (advisor?.label ?? 'Smart plan')
        this.recsHint.title =
          this.mode === 'demo'
            ? 'Simulated hourly frame, computed locally from the AQI forecast. Switch to Live for the current snapshot.'
            : advisor?.mode === 'ai'
              ? `Grounded actions rewritten by ${advisor.model ?? 'an AI model'}.`
              : 'Computed locally from live AQI and the solar forecast. Configure an AI key to enable AI wording.'
      }
      this.root.classList.remove('is-loading', 'is-error')
      return
    }

    this.recs.replaceChildren(h('p', { class: 'source-note' }, status === 'error' ? 'Recommendations need the solar forecast.' : 'Loading recommendations…'))
    if (status === 'error') {
      this.root.classList.add('is-error')
      this.body.replaceChildren(
        notice({
          tone: 'error',
          title: 'Solar forecast is unavailable',
          body: error,
          action: button({ label: 'Try again', onClick: () => void this.load() }),
        }),
      )
      return
    }

    this.root.classList.add('is-loading')
    this.body.replaceChildren(
      h('div', { class: 'solar-card__loading', 'aria-busy': 'true' }, skeleton('9rem', '2.6rem'), skeleton('100%', '170px'), skeleton('100%', '3.5rem')),
    )
  }

  renderReady(data, frame) {
    const horizon = frame ? data.forecast.slice(this.frame) : data.forecast
    const note = noteFor(horizon)
    const hazy = Boolean(note?.hazy)
    const currentKw = frame ? Number(frame.current_kw) : Number(data.current_kw)
    const pm25 = frame ? frame.pm25 : data.pm25
    const clock = frame ? `Demo clock · ${fmtTime(new Date(frame.timestamp))}` : 'Live snapshot'
    const now = h(
      'div',
      { class: 'solar-card__now' },
      h(
        'div',
        { class: 'solar-card__reading' },
        h(
          'p',
          { class: 'solar-card__label' },
          this.mode === 'demo' ? 'Simulated output' : 'Current output',
          h('span', { class: 'solar-card__flag' }, 'Synthetic'),
        ),
        h(
          'p',
          { class: 'solar-card__value' },
          h('span', { class: 'solar-card__kw num' }, fmtKw(currentKw)),
          h('span', { class: 'solar-card__unit' }, 'kW'),
        ),
        h('p', { class: 'solar-card__clock' }, clock),
        currentKw === 0 && h('p', { class: 'source-note' }, 'The sun is down; output resumes after 06:00.'),
      ),
      h(
        'dl',
        { class: 'solar-card__meta' },
        h('div', {}, h('dt', {}, 'Demo site'), h('dd', {}, data.site)),
        h('div', {}, h('dt', {}, 'Municipality'), h('dd', {}, data.municipality)),
        h('div', {}, h('dt', {}, 'PM2.5'), h('dd', { class: 'num' }, fmtPm(pm25))),
      ),
    )

    this.chart.update(data.forecast, frame ? this.frame : null)
    const noteText = data.degraded
      ? 'PM2.5 is unavailable right now, so the AQI-aware line falls back to the weather-only forecast.'
      : note?.text

    this.body.replaceChildren(
      now,
      this.chart.el,
      noteText && h('p', { class: cx('solar-note', hazy && !data.degraded && 'solar-note--hazy') }, noteText),
    )
  }
}
