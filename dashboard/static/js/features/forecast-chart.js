/**
 * 48 hours of the index: the past 24 solid, the forecast 24 dashed, a rule at
 * now, and hairlines at the band thresholds. Pointer or arrow keys move the
 * readout. Switching municipality morphs the existing lines into the new
 * series on a spring (see lib/motion.js) rather than redrawing.
 */
import { cx, h, replay, s } from '../lib/dom.js'
import { LEVELS, levelLabel, rankForIndex } from '../lib/levels.js'
import { fmtDayTime, fmtTime, fmtWeekday, fromUnix, localHour } from '../lib/format.js'
import { animateSpring, spring } from '../lib/motion.js'
import { NumberTicker } from '../ui/ticker.js'

const H = 200
const PAD = { top: 12, right: 8, bottom: 26, left: 30 }
const lerp = (a, b, t) => a + (b - a) * t

/** Midnight shows the weekday; other ticks show the hour. */
function tickLabel(ts) {
  const d = fromUnix(ts)
  const hr = localHour(d)
  return hr === 0 ? fmtWeekday(d) : `${String(hr).padStart(2, '0')}:00`
}

export class ForecastChart {
  constructor() {
    this.points = []
    this.nowTs = 0
    this.width = 0
    this.cursor = null
    this.shown = null // geometry currently drawn (may be mid-morph)
    this.stopMorph = () => {}

    this.when = h('span', { class: 'chart__when' })
    this.ticker = new NumberTicker({ className: 'chart__value' })
    this.levelText = h('span')
    this.level = h('span', { class: 'chart__level' }, h('span', { class: 'chart__level-dot', 'aria-hidden': 'true' }), this.levelText)
    this.kind = h('span', { class: 'chart__kind' }, 'Forecast')

    this.bandsG = s('g')
    this.bands = new Map() // level key -> <g>
    this.area = s('path', { class: 'chart__area' })
    this.past = s('path', { class: 'chart__past', pathLength: '1' })
    this.future = s('path', { class: 'chart__future' })
    this.nowLine = s('line', { class: 'chart__now', y1: PAD.top, y2: H - PAD.bottom })
    this.ticksG = s('g')
    this.cursorLine = s('line', { class: 'chart__cursor', x1: 0, x2: 0, y1: PAD.top, y2: H - PAD.bottom })
    this.cursorG = s('g', { class: 'chart__pointer' }, this.cursorLine)
    this.dotG = s('g', { class: 'chart__pointer' }, s('circle', { class: 'chart__halo', r: 9 }), s('circle', { class: 'chart__dot', r: 4 }))

    this.svg = s(
      'svg',
      {
        height: H,
        tabindex: '0',
        role: 'img',
        'aria-label': 'Plume index over the past 24 hours and the next 24 hours. Use the left and right arrow keys to read hourly values.',
        onpointermove: (e) => this.pick(e),
        onpointerleave: () => this.setCursor(null),
        onkeydown: (e) => this.keys(e),
        onblur: () => this.setCursor(null),
      },
      this.bandsG,
      this.area,
      this.past,
      this.future,
      this.nowLine,
      this.ticksG,
      this.cursorG,
      this.dotG,
    )
    this.axisTag = h('span', { class: 'chart__axis-tag num' })
    this.axisAnchor = h('span', { class: 'chart__axis-anchor', 'aria-hidden': 'true' }, this.axisTag)
    this.frame = h('div', { class: 'chart__frame' }, this.svg, this.axisAnchor)

    this.el = h(
      'figure',
      { class: 'chart chart--intro' },
      h('figcaption', { class: 'chart__readout', 'aria-live': 'polite' }, this.when, h('span', { class: 'chart__figure' }, this.ticker.el, this.level, this.kind)),
      this.frame,
      h('p', { class: 'chart__legend' }, h('span', { class: 'legend legend--past' }, 'Past 24 hours'), h('span', { class: 'legend legend--future' }, 'Forecast')),
    )
    this.future.addEventListener('animationend', () => this.el.classList.remove('chart--intro'))

    new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      if (w === this.width) return
      this.width = w
      this.render(false)
    }).observe(this.frame)
  }

  /** Play the draw-in again, e.g. when the chart reappears. */
  intro() {
    replay(this.el, 'chart--intro')
  }

  update(points, nowTs) {
    const changed = points !== this.points || nowTs !== this.nowTs
    this.points = points
    this.nowTs = nowTs
    if (changed) {
      this.cursor = null
      this.render(true)
    }
  }

  get nowIdx() {
    let idx = 0
    this.points.forEach((p, i) => {
      if (p.timestamp <= this.nowTs) idx = i
    })
    return idx
  }

  /** Target geometry for the current points at the current width. */
  geometry() {
    const pts = this.points
    const w = Math.max(this.width, 240)
    // Round the ceiling to a band-friendly step so the y scale does not jitter between neighbours.
    const maxV = Math.ceil((Math.max(60, ...pts.map((p) => p.plume_index)) * 1.1) / 25) * 25
    const t0 = pts[0]?.timestamp ?? 0
    const t1 = pts[pts.length - 1]?.timestamp ?? 1
    const x = (t) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (w - PAD.left - PAD.right)
    const y = (v) => PAD.top + (1 - v / maxV) * (H - PAD.top - PAD.bottom)
    // Label spacing of at least ~56px: every 6, 12 or 24 hours depending on width.
    const pxPerHour = (w - PAD.left - PAD.right) / Math.max(1, (t1 - t0) / 3600)
    const step = [6, 12, 24].find((hrs) => hrs * pxPerHour >= 56) ?? 24
    return {
      w,
      xs: pts.map((p) => x(p.timestamp)),
      ys: pts.map((p) => y(p.plume_index)),
      base: y(0),
      bands: new Map(LEVELS.filter((l) => l.min > 0 && l.min < maxV).map((l) => [l.key, { min: l.min, y: y(l.min) }])),
      nowX: x(this.nowTs),
      ticks: pts.filter((p) => localHour(fromUnix(p.timestamp)) % step === 0).map((p) => ({ ts: p.timestamp, x: x(p.timestamp) })),
    }
  }

  render(animate) {
    if (this.points.length < 2 || !this.width) return
    const to = this.geometry()
    const from = this.shown
    this.stopMorph()
    const canMorph = animate && from && from.xs.length === to.xs.length && from.w === to.w
    if (!canMorph) return this.draw(to)

    this.svg.classList.add('is-morphing')
    this.stopMorph = animateSpring(
      0,
      1,
      spring.chart,
      (t) => {
        const bands = new Map()
        for (const [k, b] of to.bands) bands.set(k, { min: b.min, y: lerp(from.bands.get(k)?.y ?? b.y, b.y, t) })
        this.draw({ ...to, xs: to.xs.map((v, i) => lerp(from.xs[i], v, t)), ys: to.ys.map((v, i) => lerp(from.ys[i], v, t)), bands })
      },
      () => this.svg.classList.remove('is-morphing'),
    )
  }

  draw(g) {
    this.shown = g
    const { w, xs, ys } = g
    const nowIdx = this.nowIdx
    this.svg.setAttribute('width', w)
    this.svg.setAttribute('viewBox', `0 0 ${w} ${H}`)

    const line = (from, to) => {
      let d = ''
      for (let i = from; i <= to; i++) d += `${i === from ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`
      return d
    }
    const last = xs.length - 1
    this.area.setAttribute('d', `${line(0, last)}L${xs[last].toFixed(1)},${g.base.toFixed(1)}L${xs[0].toFixed(1)},${g.base.toFixed(1)}Z`)
    this.past.setAttribute('d', line(0, nowIdx))
    this.future.setAttribute('d', line(nowIdx, last))
    this.nowLine.setAttribute('x1', g.nowX)
    this.nowLine.setAttribute('x2', g.nowX)

    for (const [k, el] of this.bands) {
      if (!g.bands.has(k)) {
        el.remove()
        this.bands.delete(k)
      }
    }
    for (const [k, b] of g.bands) {
      let el = this.bands.get(k)
      if (!el) {
        el = s('g', { class: 'chart__band' }, s('line', { y1: 0, y2: 0 }), s('text', { y: 0, dy: '0.32em', 'text-anchor': 'end' }, String(b.min)))
        this.bands.set(k, el)
        this.bandsG.append(el)
      }
      el.setAttribute('transform', `translate(0 ${b.y.toFixed(1)})`)
      const ln = el.firstChild
      ln.setAttribute('x1', PAD.left)
      ln.setAttribute('x2', w - PAD.right)
      el.lastChild.setAttribute('x', PAD.left - 8)
    }

    this.ticksG.replaceChildren(...g.ticks.map((t) => s('text', { class: 'chart__tick', x: t.x, y: H - 8, 'text-anchor': 'middle', dataset: { x: t.x } }, tickLabel(t.ts))))
    this.drawPointer()
  }

  /** Readout, cursor, dot and axis tag for the active hour. */
  drawPointer() {
    const g = this.shown
    if (!g) return
    const nowIdx = this.nowIdx
    const idx = Math.min(this.cursor ?? nowIdx, this.points.length - 1)
    const active = this.points[idx]
    const ax = g.xs[idx]
    const ay = g.ys[idx]
    const hovering = this.cursor !== null && this.cursor !== nowIdx
    const rank = rankForIndex(active.plume_index)

    this.when.textContent = hovering ? fmtDayTime(fromUnix(active.timestamp)) : 'Now'
    this.ticker.set(active.plume_index)
    this.level.className = cx('chart__level', `sev-${rank}`)
    this.levelText.textContent = levelLabel(rank)
    this.kind.classList.toggle('is-on', active.timestamp > this.nowTs)

    this.cursorG.style.transform = `translate(${ax}px, 0)`
    this.cursorLine.classList.toggle('is-on', hovering)
    this.dotG.style.transform = `translate(${ax}px, ${ay}px)`
    for (const t of this.ticksG.children) t.classList.toggle('is-hidden', hovering && Math.abs(Number(t.dataset.x) - ax) < 34)

    this.axisAnchor.classList.toggle('is-on', hovering)
    this.axisAnchor.style.transform = `translateX(${ax}px)`
    if (hovering) this.axisTag.textContent = fmtTime(fromUnix(active.timestamp))
  }

  setCursor(i) {
    if (i === this.cursor) return
    this.cursor = i
    this.drawPointer()
  }

  pick(e) {
    if (!this.shown) return
    const px = e.clientX - this.svg.getBoundingClientRect().left
    let best = 0
    this.shown.xs.forEach((x, i) => {
      if (Math.abs(x - px) < Math.abs(this.shown.xs[best] - px)) best = i
    })
    this.setCursor(best)
  }

  keys(e) {
    const cur = this.cursor ?? this.nowIdx
    const last = this.points.length - 1
    if (e.key === 'ArrowRight') this.setCursor(Math.min(last, cur + 1))
    else if (e.key === 'ArrowLeft') this.setCursor(Math.max(0, cur - 1))
    else if (e.key === 'Home') this.setCursor(0)
    else if (e.key === 'End') this.setCursor(last)
    else return
    e.preventDefault()
  }
}
