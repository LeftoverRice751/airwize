/**
 * Trend chart for the Energy tab: stored energy (%) for sites with storage,
 * load (W) for grid sites. The caption states the measure, unit, time range
 * and whether the data is simulated or live. Pointer or arrow keys read
 * individual values. With no data it shows a message instead of a line.
 *
 *   chart.update({ points: [{ time: Date, value: number }], kind: 'charge'|'load',
 *                  range: [Date, Date] | null, mode: 'simulation'|'live', empty: 'text' })
 */
import { h, s } from '../../lib/dom.js'
import { fmtNumber, fmtTime } from '../../lib/format.js'

const H = 210
const PAD = { top: 14, right: 12, bottom: 26, left: 44 }

const KINDS = {
  charge: { title: 'Stored energy', unit: '% of capacity', short: '%', fmt: (v) => `${Math.round(v)}%` },
  load: { title: 'Load', unit: 'watts', short: 'W', fmt: (v) => `${fmtNumber(v)} W` },
}

function niceMax(v) {
  if (v <= 0) return 1000
  const step = 10 ** Math.floor(Math.log10(v))
  return Math.ceil((v * 1.15) / (step / 2)) * (step / 2)
}

export class EnergyChart {
  constructor() {
    this.width = 0
    this.cursor = null
    this.props = null

    this.title = h('h2', { id: 'energy-chart-title' })
    this.tag = h('span', { class: 'energy-tag' })
    this.caption = h('p', { class: 'energy-chart__caption' })
    this.readout = h('p', { class: 'energy-chart__readout num', 'aria-live': 'polite' })
    this.message = h('p', { class: 'energy-chart__empty' })

    this.gridG = s('g', { class: 'energy-chart__grid' })
    this.ticksG = s('g')
    this.area = s('path', { class: 'chart__area' })
    this.line = s('path', { class: 'chart__past' })
    this.cursorLine = s('line', { class: 'chart__cursor', y1: PAD.top, y2: H - PAD.bottom })
    this.dot = s('circle', { class: 'chart__dot', r: 4, visibility: 'hidden' })
    this.svg = s(
      'svg',
      {
        height: H,
        tabindex: '0',
        role: 'img',
        onpointermove: (e) => this.pick(e),
        onpointerleave: () => this.setCursor(null),
        onkeydown: (e) => this.keys(e),
        onblur: () => this.setCursor(null),
      },
      this.gridG,
      this.area,
      this.line,
      this.ticksG,
      this.cursorLine,
      this.dot,
    )
    this.frame = h('div', { class: 'chart__frame energy-chart__frame' }, this.svg, this.message)
    this.el = h(
      'section',
      { class: 'panel energy-chart', 'aria-labelledby': 'energy-chart-title' },
      h('header', { class: 'energy-panel__head' }, this.title, this.tag),
      this.caption,
      h('figure', { class: 'chart' }, this.readout, this.frame),
    )
    new ResizeObserver(() => {
      const w = Math.round(this.frame.clientWidth)
      if (w && w !== this.width) {
        this.width = w
        this.draw()
      }
    }).observe(this.frame)
  }

  update(props) {
    this.props = props
    const k = KINDS[props.kind]
    this.title.textContent = `${k.title} over time`
    this.tag.textContent = props.mode === 'simulation' ? 'Simulated data' : 'Live data'
    this.tag.dataset.mode = props.mode
    const range = props.range ? `${fmtTime(props.range[0])}–${fmtTime(props.range[1])}` : 'no readings yet'
    this.caption.textContent =
      props.mode === 'simulation'
        ? `${k.title} in ${k.unit}, on the demo clock, ${range}. Scripted scenario, not measured.`
        : `${k.title} in ${k.unit}, as reported by the solar system, ${range} (Manila time). Readings collected since this page opened.`
    this.draw()
  }

  draw() {
    const p = this.props
    if (!p || !this.width) return
    const k = KINDS[p.kind]
    const pts = p.points.filter((x) => typeof x.value === 'number')
    const ok = pts.length >= 2 && p.range
    this.message.hidden = ok
    this.message.textContent = ok ? '' : p.empty
    this.svg.style.visibility = ok ? 'visible' : 'hidden'
    this.svg.setAttribute('width', this.width)
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${H}`)
    if (!ok) {
      this.readout.textContent = ''
      this.dot.setAttribute('visibility', 'hidden')
      this.cursorLine.classList.remove('is-on')
      this.svg.setAttribute('aria-label', p.empty)
      this.geom = null
      return
    }

    const [t0, t1] = p.range.map((d) => d.getTime())
    const yMax = p.kind === 'charge' ? 100 : niceMax(Math.max(...pts.map((x) => x.value)))
    const x = (t) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (this.width - PAD.left - PAD.right)
    const y = (v) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom)
    this.geom = { pts, x, y, k }

    // Horizontal gridlines with unit labels.
    const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)
    this.gridG.replaceChildren(
      ...steps.map((v) =>
        s('g', {}, s('line', { x1: PAD.left, x2: this.width - PAD.right, y1: y(v), y2: y(v) }), s('text', { x: PAD.left - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, k.fmt(v))),
      ),
    )

    // Hour ticks.
    const ticks = []
    const first = Math.ceil(t0 / 3_600_000) * 3_600_000
    const every = (t1 - t0) / 3_600_000 > 8 ? 2 : 1
    for (let t = first; t <= t1; t += 3_600_000 * every) ticks.push(t)
    if ((t1 - t0) < 3_600_000) ticks.splice(0, ticks.length, t0, t1)
    const anchor = (px) => (px < PAD.left + 16 ? 'start' : px > this.width - PAD.right - 16 ? 'end' : 'middle')
    this.ticksG.replaceChildren(...ticks.map((t) => s('text', { class: 'chart__tick', x: x(t), y: H - 8, 'text-anchor': anchor(x(t)) }, fmtTime(new Date(t)))))

    const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.time.getTime()).toFixed(1)},${y(pt.value).toFixed(1)}`).join('')
    this.line.setAttribute('d', d)
    const base = y(0)
    this.area.setAttribute('d', `${d}L${x(pts.at(-1).time.getTime()).toFixed(1)},${base}L${x(pts[0].time.getTime()).toFixed(1)},${base}Z`)

    const last = pts.at(-1)
    this.svg.setAttribute(
      'aria-label',
      `${k.title} from ${fmtTime(pts[0].time)} to ${fmtTime(last.time)}, latest ${k.fmt(last.value)}${p.mode === 'simulation' ? ', simulated' : ''}. Use the left and right arrow keys to read values.`,
    )
    this.setCursor(this.cursor !== null && this.cursor < pts.length ? this.cursor : null)
  }

  pick(e) {
    if (!this.geom) return
    const rect = this.svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const { pts, x } = this.geom
    let best = 0
    pts.forEach((pt, i) => {
      if (Math.abs(x(pt.time.getTime()) - px) < Math.abs(x(pts[best].time.getTime()) - px)) best = i
    })
    this.setCursor(best)
  }

  keys(e) {
    if (!this.geom) return
    const n = this.geom.pts.length
    const step = e.shiftKey ? 10 : 1
    const at = this.cursor ?? n - 1
    let next = null
    if (e.key === 'ArrowLeft') next = Math.max(0, at - step)
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, at + step)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next === null) return
    e.preventDefault()
    this.setCursor(next)
  }

  setCursor(i) {
    this.cursor = i
    const g = this.geom
    if (!g) return
    const pt = g.pts[i ?? g.pts.length - 1]
    const on = i !== null
    const cx = g.x(pt.time.getTime())
    this.cursorLine.setAttribute('x1', cx)
    this.cursorLine.setAttribute('x2', cx)
    this.cursorLine.classList.toggle('is-on', on)
    this.dot.setAttribute('cx', cx)
    this.dot.setAttribute('cy', g.y(pt.value))
    this.dot.setAttribute('visibility', 'visible')
    this.readout.textContent = `${on ? fmtTime(pt.time) : `Latest, ${fmtTime(pt.time)}`}: ${g.k.fmt(pt.value)}`
  }
}
