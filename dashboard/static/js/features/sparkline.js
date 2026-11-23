/**
 * The next 24 hours as one line, on a scale shared by every row so rows
 * compare. It draws in on first paint and morphs (where the browser can
 * transition the CSS `d` property) when a new snapshot changes the series.
 */
import { h, s } from '../lib/dom.js'

const CSS_D = typeof CSS !== 'undefined' && CSS.supports?.('d', 'path("M0,0")')

export class Sparkline {
  constructor({ width = 96, height = 28 } = {}) {
    this.width = width
    this.height = height
    this.path = s('path', { pathLength: '1' })
    this.peak = s('circle', { class: 'spark__peak', r: 2 })
    this.svg = s('svg', { class: 'spark spark--intro', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' }, this.path, this.peak)
    // Drop the intro class once played, so moving the row (re-sorting) does not replay it.
    this.peak.addEventListener('animationend', () => this.svg.classList.remove('spark--intro'))
    this.empty = h('span', { class: 'muted' }, 'n/a')
    this.el = h('span', { class: 'spark-slot' })
  }

  update(points, max, active) {
    if (points.length < 2) {
      if (this.el.firstChild !== this.empty) this.el.replaceChildren(this.empty)
      return
    }
    if (this.el.firstChild !== this.svg) this.el.replaceChildren(this.svg)

    const { width, height } = this
    const step = width / (points.length - 1)
    const y = (v) => height - 2 - (v / max) * (height - 4)
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(p.plume_index).toFixed(1)}`).join('')
    const hi = points.reduce((a, b) => (b.plume_index > a.plume_index ? b : a))
    const lo = points.reduce((a, b) => (b.plume_index < a.plume_index ? b : a))

    this.path.setAttribute('d', d)
    if (CSS_D) this.path.style.d = `path("${d}")`
    this.peak.setAttribute('cx', (points.indexOf(hi) * step).toFixed(1))
    this.peak.setAttribute('cy', y(hi.plume_index).toFixed(1))
    this.svg.classList.toggle('is-active', active)
    this.svg.setAttribute('aria-label', `Next 24 hours: low ${Math.round(lo.plume_index)}, high ${Math.round(hi.plume_index)}`)
  }
}
