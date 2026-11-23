/**
 * Stat tiles for the Energy tab. Which tiles appear is decided by
 * energy-view.js (site type, mode, storage); this only renders them, keyed by
 * id so values update in place.
 *
 *   tiles.update([{ id, label, value, unit?, detail, tag, tone? }])
 *   tag: 'Simulated' | 'Scripted' | 'Live' | 'Plume Labs' ... (who supplied the value)
 *   tone: 'missing' greys the value when the source did not supply it
 */
import { h } from '../../lib/dom.js'

export class EnergyTiles {
  constructor(el) {
    this.el = el
    this.tiles = new Map()
    this.signature = ''
  }

  update(list) {
    const signature = list.map((t) => t.id).join('|')
    if (signature !== this.signature) {
      this.signature = signature
      this.tiles.clear()
      this.el.replaceChildren(
        ...list.map((t) => {
          const label = h('span', { class: 'stat__label' })
          const tag = h('span', { class: 'energy-tag' })
          const value = h('dd', { class: 'stat__value num' })
          const detail = h('dd', { class: 'stat__detail' })
          const el = h('div', { class: 'stat energy-stat', dataset: { tile: t.id } }, h('dt', { class: 'energy-stat__head' }, label, tag), value, detail)
          this.tiles.set(t.id, { el, label, tag, value, detail })
          return el
        }),
      )
    }
    for (const t of list) {
      const n = this.tiles.get(t.id)
      n.label.textContent = t.label
      n.tag.textContent = t.tag
      n.tag.dataset.mode = t.tagMode ?? ''
      n.el.classList.toggle('is-missing', t.tone === 'missing')
      if (n.value.dataset.v !== t.value + (t.unit ?? '')) {
        n.value.dataset.v = t.value + (t.unit ?? '')
        n.value.replaceChildren(t.value, t.unit ? h('span', { class: 'stat__of' }, ` ${t.unit}`) : '')
      }
      n.detail.textContent = t.detail
    }
  }
}
