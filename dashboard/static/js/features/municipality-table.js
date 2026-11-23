/**
 * The ledger: one row per municipality, sortable; selecting a row opens its
 * detail. Rows are keyed by city and updated in place, so tickers glide,
 * sparklines morph and re-sorting slides rows (FLIP) instead of redrawing.
 */
import { cx, h, icon, reducedMotion, skeleton } from '../lib/dom.js'
import { POLLUTANT_ORDER, fmtConc, pollutantName } from '../lib/format.js'
import { levelRank } from '../lib/levels.js'
import { flip } from '../lib/motion.js'
import { splitForecast } from '../lib/outlook.js'
import { levelBadge } from '../ui/primitives.js'
import { NumberTicker } from '../ui/ticker.js'
import { Sparkline } from './sparkline.js'

/** Width of the index bar is the index against this ceiling (top of "unhealthy"). */
const BAR_CEILING = 150

export class MunicipalityTable {
  constructor({ onSelect, onSort }) {
    this.onSelect = onSelect
    this.rows = new Map() // city -> row parts
    this.skeletonShown = false

    const sortHead = (key, label, cls) => {
      const btn = h('button', { type: 'button', class: 'th-sort', onclick: () => onSort(key) }, label, icon('sort', 13, { className: 'th-sort__icon' }))
      const th = h('th', { scope: 'col', class: cls }, btn)
      return { key, th, btn }
    }
    this.sortHeads = [sortHead('name', 'Municipality'), sortHead('index', 'Index', 'num-col')]

    this.tbody = h('tbody')
    this.marker = h('span', { class: 'ledger__marker', 'aria-hidden': 'true', hidden: true })
    this.el = h(
      'div',
      { class: 'ledger' },
      this.marker,
      h(
        'table',
        { class: 'table' },
        h('caption', { class: 'visually-hidden' }, 'Current air quality by municipality. Concentrations in micrograms per cubic metre.'),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            this.sortHeads.map((s) => s.th),
            h('th', { scope: 'col' }, 'Level'),
            POLLUTANT_ORDER.map((k) => h('th', { scope: 'col', class: 'num-col col-pollutant' }, pollutantName(k))),
            h('th', { scope: 'col', class: 'col-spark' }, 'Next 24 hours'),
          ),
        ),
        this.tbody,
      ),
    )
    new ResizeObserver(() => this.placeMarker()).observe(this.el)
  }

  update(rows, selected, sort) {
    for (const { key, th, btn } of this.sortHeads) {
      th.setAttribute('aria-sort', sort === key ? (key === 'index' ? 'descending' : 'ascending') : 'none')
      btn.classList.toggle('is-active', sort === key)
    }
    this.selected = selected
    if (rows === null) return this.showSkeleton()
    if (this.skeletonShown) {
      this.tbody.replaceChildren()
      this.skeletonShown = false
    }

    const sparkMax = Math.max(60, ...rows.flatMap((m) => splitForecast(m).future.map((p) => p.plume_index)))
    const wanted = new Set(rows.map((m) => m.city))
    for (const [city, r] of this.rows) {
      if (!wanted.has(city)) {
        r.tr.remove()
        this.rows.delete(city)
      }
    }

    const ordered = rows.map((m, i) => {
      let r = this.rows.get(m.city)
      if (!r) {
        r = this.createRow(m, i)
        this.rows.set(m.city, r)
      }
      this.fillRow(r, m, m.city === selected, sparkMax)
      return r.tr
    })

    const current = [...this.tbody.children]
    const sameOrder = current.length === ordered.length && current.every((tr, i) => tr === ordered[i])
    if (!sameOrder) flip(current, () => this.tbody.append(...ordered))
    this.placeMarker()
  }

  createRow(m, i) {
    const delay = Math.min(i, 12) * 18
    const ticker = new NumberTicker({ className: 'index-cell__value' })
    const fill = h('span', { class: 'index-bar__fill', style: { transform: 'scaleX(0)', transitionDelay: reducedMotion() ? '0ms' : `${delay}ms` } })
    const select = h('button', { type: 'button', class: 'row__select', onclick: (e) => (e.stopPropagation(), this.onSelect(m.city)) }, m.city)
    const sub = h('span', { class: 'cell-sub' })
    const level = h('td', { 'data-label': 'Level' })
    const pollutants = POLLUTANT_ORDER.map((k) => h('td', { class: 'num-col col-pollutant num', 'data-label': pollutantName(k) }))
    const spark = new Sparkline()
    const tr = h(
      'tr',
      { class: 'row row--enter', style: { animationDelay: `${delay}ms` }, onclick: () => this.onSelect(m.city) },
      h('th', { scope: 'row', class: 'cell-name' }, select, sub),
      h('td', { class: 'num-col', 'data-label': 'Index' }, h('span', { class: 'index-cell' }, ticker.el, h('span', { class: 'index-bar', 'aria-hidden': 'true' }, fill))),
      level,
      pollutants,
      h('td', { class: 'col-spark', 'data-label': 'Next 24 hours' }, spark.el),
    )
    // Drop the entry class once played, so moving the row (re-sorting) does not replay it.
    tr.addEventListener('animationend', (e) => e.target === tr && tr.classList.remove('row--enter'))
    const r = { tr, ticker, fill, select, sub, level, pollutants, spark, rank: -1, scale: 0, growing: true }
    // The bar starts at zero and grows on the next frames; later updates have no delay.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        r.growing = false
        fill.style.transform = `scaleX(${r.scale})`
        fill.addEventListener('transitionend', () => (fill.style.transitionDelay = '0ms'), { once: true })
      }),
    )
    return r
  }

  fillRow(r, m, isSel, sparkMax) {
    const rank = levelRank(m.level)
    r.tr.classList.toggle('is-selected', isSel)
    r.select.setAttribute('aria-pressed', String(isSel))
    r.sub.textContent = m.municipality !== m.city ? m.municipality : ''
    r.sub.hidden = m.municipality === m.city
    r.ticker.set(m.plume_index)

    r.scale = Math.min(1, m.plume_index / BAR_CEILING)
    r.fill.className = cx('index-bar__fill', `sev-${rank}`)
    if (!r.growing) r.fill.style.transform = `scaleX(${r.scale})`

    if (rank !== r.rank) r.level.replaceChildren(levelBadge(rank))
    r.rank = rank
    POLLUTANT_ORDER.forEach((k, i) => (r.pollutants[i].textContent = fmtConc(m.pollutants?.[k]?.value_upm)))
    r.spark.update(splitForecast(m).future, sparkMax, isSel)
  }

  /** One accent marker that slides to the selected row. */
  placeMarker() {
    const r = this.rows.get(this.selected)
    if (!r || !r.tr.isConnected || this.skeletonShown) {
      this.marker.hidden = true
      return
    }
    const table = r.tr.closest('table')
    const inset = window.matchMedia('(max-width: 48rem)').matches ? 14 : 10
    const top = table.offsetTop + r.tr.offsetTop + inset // offsetTop ignores FLIP transforms
    const first = this.marker.hidden
    this.marker.hidden = false
    this.marker.classList.toggle('no-transition', first)
    Object.assign(this.marker.style, { height: `${Math.max(0, r.tr.offsetHeight - inset * 2)}px`, transform: `translateY(${top}px)` })
  }

  showSkeleton() {
    if (this.skeletonShown) return
    this.skeletonShown = true
    this.rows.clear()
    this.marker.hidden = true
    const skRow = () =>
      h(
        'tr',
        { class: 'row--skeleton', 'aria-hidden': 'true' },
        h('td', {}, skeleton('7rem'), skeleton('4.5rem', '0.7em')),
        h('td', { class: 'num-col' }, skeleton('4rem')),
        h('td', {}, skeleton('4.5rem')),
        POLLUTANT_ORDER.map(() => h('td', { class: 'col-pollutant' }, skeleton('2.5rem'))),
        h('td', { class: 'col-spark' }, skeleton('6rem', '1.5rem')),
      )
    this.tbody.replaceChildren(...Array.from({ length: 8 }, skRow))
  }
}
