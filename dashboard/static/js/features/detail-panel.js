/**
 * Detail for the selected municipality: advice, the 48-hour chart, forecast
 * analysis, current conditions and a quick alert form. Text blocks cross-fade
 * when the municipality changes; the chart sits outside them so it morphs.
 */
import { h, icon, replay, skeleton } from '../lib/dom.js'
import { levelLabel, levelRank, rankForIndex } from '../lib/levels.js'
import { fmtDayTime, fmtIndex, fmtTime, fmtWeekday, fromUnix, pollutantName, signed } from '../lib/format.js'
import { bestWindow, dominantPollutant, peak, sixHourTrend, splitForecast } from '../lib/outlook.js'
import { levelBadge } from '../ui/primitives.js'
import { AlertTrigger } from '../ui/alert-trigger.js'
import { NumberTicker } from '../ui/ticker.js'
import { ForecastChart } from './forecast-chart.js'

const TREND_WORDS = { rising: 'Rising', easing: 'Easing', steady: 'Steady' }

function fact(label) {
  const dd = h('dd')
  return { el: h('div', { class: 'fact' }, h('dt', {}, label), dd), dd }
}

const sub = (...children) => h('span', { class: 'fact__sub' }, ...children)

export class DetailPanel {
  constructor({ onSaveRule }) {
    this.city = null
    this.mode = null // 'skeleton' | 'detail' | 'hidden'
    this.el = h('section', { class: 'panel' })

    this.title = h('h2', { id: 'detail-title' })
    this.placeText = h('span')
    this.source = h('a', { class: 'ext-link', target: '_blank', rel: 'noreferrer' }, 'Source ', icon('external', 13))
    this.badgeSlot = h('span', { class: 'advisory__badge' })
    this.advice = h('p', { class: 'advisory__text' })
    this.top = h(
      'div',
      { class: 'panel__top' },
      h('header', { class: 'panel__head' }, h('div', {}, this.title, h('p', { class: 'panel__place' }, icon('pin', 14), this.placeText)), this.source),
      h('div', { class: 'advisory' }, this.badgeSlot, this.advice),
    )

    this.chart = new ForecastChart()

    this.peak = fact('Peak, next 24 hours')
    this.trend = fact('Six-hour trend')
    this.window = fact('Cleanest 3 daytime hours')
    this.driver = fact('Driving pollutant')
    this.peakTicker = new NumberTicker({ className: 'fact__big' })
    this.trendTicker = new NumberTicker({ className: 'fact__big', format: signed })

    this.temp = h('span', { class: 'num' })
    this.uv = h('dd', { class: 'num' })
    this.sky = h('dd')
    this.readingNote = h('p', { class: 'source-note' })
    this.alertTitle = h('h3')
    this.trigger = new AlertTrigger({ onSubmit: onSaveRule })

    this.body = h(
      'div',
      { class: 'panel__body' },
      h('div', { class: 'panel__section' }, h('h3', {}, 'Outlook'), h('dl', { class: 'facts' }, this.peak.el, this.trend.el, this.window.el, this.driver.el)),
      h(
        'div',
        { class: 'panel__section' },
        h('h3', {}, 'Conditions'),
        h(
          'dl',
          { class: 'conditions' },
          h('div', {}, h('dt', {}, 'Temperature'), h('dd', {}, this.temp, ' °C')),
          h('div', {}, h('dt', {}, 'UV index'), this.uv),
          h('div', {}, h('dt', {}, 'Sky'), this.sky),
        ),
        this.readingNote,
      ),
      h('div', { class: 'panel__section' }, this.alertTitle, this.trigger.el),
    )
  }

  /** m: a municipality, null while loading (skeleton), undefined for nothing to show. */
  update(m) {
    if (m === null) return this.showSkeleton()
    if (!m) {
      this.mode = 'hidden'
      this.el.hidden = true
      return
    }
    this.el.hidden = false
    if (this.mode !== 'detail') {
      this.mode = 'detail'
      this.el.removeAttribute('aria-busy')
      this.el.removeAttribute('aria-label')
      this.el.setAttribute('aria-labelledby', 'detail-title')
      this.el.replaceChildren(this.top, this.body)
      this.city = null
    }
    if (m.city !== this.city) {
      if (this.city !== null) {
        replay(this.top, 'swap-in')
        replay(this.body, 'swap-in')
      }
      this.city = m.city
    }

    const { future } = splitForecast(m)
    const nowTs = Date.parse(m.measured_at) / 1000

    this.title.textContent = m.city
    this.placeText.textContent = `${m.municipality}, ${m.region}`
    this.source.href = m.url
    this.badgeSlot.replaceChildren(levelBadge(levelRank(m.level), 'lg'))
    this.advice.textContent = m.advice
    this.advice.hidden = !m.advice

    // The chart shows only when there is a forecast to draw.
    const showChart = future.length > 0 && (m.forecast ?? []).length >= 2
    if (showChart && !this.chart.el.isConnected) {
      this.top.after(this.chart.el)
      this.chart.intro()
    } else if (!showChart) this.chart.el.remove()
    if (showChart) this.chart.update(m.forecast, nowTs)

    this.fillOutlook(m, future)

    this.temp.textContent = m.weather.temperature.toFixed(1)
    this.uv.textContent = m.weather.uv.toFixed(0)
    this.sky.textContent = m.weather.icon ? m.weather.icon[0].toUpperCase() + m.weather.icon.slice(1).replace(/[-_]/g, ' ') : 'n/a'
    this.readingNote.textContent = `Reading for ${fmtTime(new Date(m.measured_at))} Manila time. Advice and forecast from Plume Labs.`
    this.alertTitle.textContent = `Alert me about ${m.city}`
    this.trigger.setCity(m.city)
  }

  fillOutlook(m, future) {
    const pk = peak(future)
    if (pk) {
      this.peakTicker.set(pk.plume_index)
      this.peak.dd.replaceChildren(this.peakTicker.el, sub(`${fmtDayTime(fromUnix(pk.timestamp))}, ${levelLabel(rankForIndex(pk.plume_index)).toLowerCase()}`))
    } else this.peak.dd.replaceChildren('n/a')

    const trend = sixHourTrend(m)
    if (trend) {
      this.trendTicker.set(trend.delta)
      this.trend.dd.replaceChildren(this.trendTicker.el, sub(TREND_WORDS[trend.trend]))
    } else this.trend.dd.replaceChildren('n/a')

    const win = bestWindow(future)
    if (win) {
      this.window.dd.replaceChildren(
        h('span', { class: 'fact__mid num' }, `${fmtTime(fromUnix(win.start.timestamp))} to ${fmtTime(fromUnix(win.end.timestamp + 3600))}`),
        sub(`${fmtWeekday(fromUnix(win.start.timestamp))}, mean `, h('span', { class: 'num' }, fmtIndex(win.mean))),
      )
    } else this.window.dd.replaceChildren(sub('No daytime hours in range'))

    const dom = dominantPollutant(m)
    if (dom) {
      this.driver.dd.replaceChildren(h('span', { class: 'fact__mid' }, pollutantName(dom)), sub('Sub-index ', h('span', { class: 'num' }, fmtIndex(m.pollutants[dom].pi))))
    } else this.driver.dd.replaceChildren('n/a')
  }

  showSkeleton() {
    if (this.mode === 'skeleton') return
    this.mode = 'skeleton'
    this.el.hidden = false
    this.el.setAttribute('aria-busy', 'true')
    this.el.setAttribute('aria-label', 'Municipality detail')
    this.el.removeAttribute('aria-labelledby')
    this.el.replaceChildren(skeleton('10rem', '1.6rem'), skeleton('14rem'), skeleton('100%', '220px'), skeleton('100%', '6rem'))
  }
}
