/**
 * Province-wide figures that appear nowhere else on the screen: the coming
 * peak across every municipality, the day-on-day change of the mean, and how
 * many municipalities are above the PM2.5 threshold that drives the haze and
 * solar recommendations.
 */
import { h, skeleton } from '../lib/dom.js'
import { dayAgo, peak, splitForecast } from '../lib/outlook.js'
import { fmtDayTime, fmtIndex, fromUnix, signed } from '../lib/format.js'
import { levelLabel, rankForIndex } from '../lib/levels.js'
import { NumberTicker } from '../ui/ticker.js'

function stat(label) {
  const value = h('dd', { class: 'stat__value' })
  const detail = h('dd', { class: 'stat__detail' })
  return { el: h('div', { class: 'stat' }, h('dt', { class: 'stat__label' }, label), value, detail), value, detail }
}

export class ProvinceStrip {
  constructor(el, { pm25High = 35 } = {}) {
    this.el = el
    this.pm25High = Number(pm25High)
    this.peak = stat('Province peak, next 24 hours')
    this.mean = stat('Mean index against 24 hours ago')
    this.haze = stat(`PM2.5 above ${this.pm25High} µg/m³`)
    this.peakTicker = new NumberTicker({ fromZero: true })
    this.meanTicker = new NumberTicker({ fromZero: true, format: signed })
    this.hazeTicker = new NumberTicker()
    this.loading = null
  }

  update(data) {
    if (!data) return this.showSkeleton()
    if (this.loading !== false) {
      this.el.removeAttribute('aria-busy')
      this.el.replaceChildren(this.peak.el, this.mean.el, this.haze.el)
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

    const readings = data
      .map((m) => {
        const pm25 = m.pollutants?.PM25?.value_upm
        return typeof pm25 === 'number' && Number.isFinite(pm25) ? { city: m.city, pm25 } : null
      })
      .filter(Boolean)
      .sort((a, b) => b.pm25 - a.pm25)
    if (readings.length) {
      const above = readings.filter((x) => x.pm25 > this.pm25High).length
      const hottest = readings[0]
      this.hazeTicker.set(above)
      this.haze.value.replaceChildren(this.hazeTicker.el, h('span', { class: 'stat__of' }, ` of ${readings.length}`))
      this.haze.detail.textContent = `Highest ${hottest.city}, ${hottest.pm25.toFixed(1)} µg/m³`
    } else {
      this.haze.value.textContent = 'n/a'
      this.haze.detail.textContent = 'No PM2.5 readings'
    }
  }

  showSkeleton() {
    if (this.loading === true) return
    this.loading = true
    this.el.setAttribute('aria-busy', 'true')
    this.el.replaceChildren(...[0, 1, 2].map(() => h('div', { class: 'stat' }, skeleton('9rem', '0.9rem'), skeleton('5rem', '1.8rem'), skeleton('11rem', '0.9rem'))))
  }
}
