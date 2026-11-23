/**
 * Province-wide figures that appear nowhere else on the screen: the coming
 * peak across every municipality, the day-on-day change of the mean, and
 * alert load.
 */
import { h, skeleton } from '../lib/dom.js'
import { dayAgo, peak, splitForecast } from '../lib/outlook.js'
import { evaluate } from '../lib/alerts.js'
import { fmtDayTime, fmtIndex, fromUnix, signed } from '../lib/format.js'
import { levelLabel, rankForIndex } from '../lib/levels.js'
import { NumberTicker } from '../ui/ticker.js'

function stat(label) {
  const value = h('dd', { class: 'stat__value' })
  const detail = h('dd', { class: 'stat__detail' })
  return { el: h('div', { class: 'stat' }, h('dt', { class: 'stat__label' }, label), value, detail), value, detail }
}

export class ProvinceStrip {
  constructor(el) {
    this.el = el
    this.peak = stat('Province peak, next 24 hours')
    this.mean = stat('Mean index against 24 hours ago')
    this.alerts = stat('Alerts triggered')
    this.peakTicker = new NumberTicker({ fromZero: true })
    this.meanTicker = new NumberTicker({ fromZero: true, format: signed })
    this.alertTicker = new NumberTicker()
    this.loading = null
  }

  update(data, rules) {
    if (!data) return this.showSkeleton()
    if (this.loading !== false) {
      this.el.removeAttribute('aria-busy')
      this.el.replaceChildren(this.peak.el, this.mean.el, this.alerts.el)
      this.loading = false
    }

    const peaks = data
      .map((m) => ({ m, p: peak(splitForecast(m).future) }))
      .filter((x) => x.p)
      .sort((a, b) => b.p.plume_index - a.p.plume_index)
    const top = peaks[0]
    if (top) {
      this.peakTicker.set(top.p.plume_index)
      this.peak.value.replaceChildren(this.peakTicker.el)
      this.peak.detail.textContent = `${top.m.city}, ${fmtDayTime(fromUnix(top.p.timestamp))}, ${levelLabel(rankForIndex(top.p.plume_index)).toLowerCase()}`
    } else {
      this.peak.value.textContent = 'n/a'
      this.peak.detail.textContent = 'No forecast available'
    }

    const pairs = data.map((m) => ({ now: m.plume_index, then: dayAgo(m) })).filter((x) => x.then !== undefined)
    const meanNow = pairs.reduce((sum, x) => sum + x.now, 0) / (pairs.length || 1)
    const meanThen = pairs.reduce((sum, x) => sum + x.then, 0) / (pairs.length || 1)
    if (pairs.length) {
      this.meanTicker.set(Math.round(meanNow - meanThen))
      this.mean.value.replaceChildren(this.meanTicker.el)
      this.mean.detail.textContent = `Now ${fmtIndex(meanNow)}, was ${fmtIndex(meanThen)}, across ${pairs.length} municipalities`
    } else {
      this.mean.value.textContent = 'n/a'
      this.mean.detail.textContent = 'Not enough history yet'
    }

    const byCity = new Map(data.map((m) => [m.city, m]))
    const statuses = rules.map((r) => evaluate(r, byCity.get(r.city)))
    const now = statuses.filter((x) => x.kind === 'triggered').length
    const soon = statuses.filter((x) => x.kind === 'forecast').length
    if (rules.length) {
      this.alertTicker.set(now)
      this.alerts.value.replaceChildren(this.alertTicker.el, h('span', { class: 'stat__of' }, ` of ${rules.length}`))
      this.alerts.detail.textContent = soon ? `${soon} more forecast to cross within 24 hours` : 'None forecast to cross within 24 hours'
    } else {
      this.alerts.value.replaceChildren(h('span', { class: 'num' }, '0'))
      this.alerts.detail.textContent = 'No alert rules yet'
    }
  }

  showSkeleton() {
    if (this.loading === true) return
    this.loading = true
    this.el.setAttribute('aria-busy', 'true')
    this.el.replaceChildren(...[0, 1, 2].map(() => h('div', { class: 'stat' }, skeleton('9rem', '0.9rem'), skeleton('5rem', '1.8rem'), skeleton('11rem', '0.9rem'))))
  }
}
