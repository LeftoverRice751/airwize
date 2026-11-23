/**
 * A row of toggles sharing one sliding thumb. Arrow keys move between enabled
 * options; state is carried by aria-pressed so screen readers hear each toggle.
 *
 *   const seg = new Segmented({ label: 'Filter by level', onChange })
 *   seg.update([{ value: 'all', label: 'All', count: 12 }, ...], 'all')
 */
import { cx, h } from '../lib/dom.js'

export class Segmented {
  constructor({ label, size = 'md', onChange }) {
    this.onChange = onChange
    this.thumb = h('span', { class: 'seg__thumb', 'aria-hidden': 'true' })
    this.el = h('div', { class: cx('seg', size === 'sm' && 'seg--sm'), role: 'group', 'aria-label': label }, this.thumb)
    this.buttons = new Map()
    this.signature = ''
    this.value = null
    new ResizeObserver(() => this.placeThumb()).observe(this.el)
  }

  update(options, value) {
    const signature = options.map((o) => `${o.value}\u0000${o.label}`).join('\u0001')
    if (signature !== this.signature) this.build(options)
    this.signature = signature
    for (const o of options) {
      const b = this.buttons.get(o.value)
      b.setAttribute('aria-pressed', String(o.value === value))
      b.disabled = o.disabled ?? o.count === 0
      const count = b.querySelector('.seg__count')
      if (count) count.textContent = o.count === undefined ? '' : String(o.count)
      if (count) count.hidden = o.count === undefined
    }
    this.value = value
    this.placeThumb()
  }

  build(options) {
    for (const b of this.buttons.values()) b.remove()
    this.buttons.clear()
    const list = []
    options.forEach((o) => {
      const b = h(
        'button',
        { type: 'button', class: 'seg__item', onclick: () => this.onChange(o.value), onkeydown: (e) => this.onKey(e, b) },
        h('span', { class: 'seg__label' }, o.label),
        h('span', { class: 'seg__count num' }),
      )
      this.buttons.set(o.value, b)
      list.push(b)
    })
    this.el.append(...list)
  }

  onKey(e, from) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const all = [...this.buttons.values()]
    for (let j = all.indexOf(from) + dir; j >= 0 && j < all.length; j += dir) {
      if (!all[j].disabled) return all[j].focus()
    }
  }

  /** Move the single thumb under the selected toggle (CSS transitions the move). */
  placeThumb() {
    const b = this.value === null ? null : this.buttons.get(this.value)
    if (!b || !b.offsetWidth) {
      this.thumb.style.opacity = '0'
      return
    }
    const first = this.thumb.style.opacity !== '1'
    if (first) this.thumb.classList.add('no-transition')
    Object.assign(this.thumb.style, {
      opacity: '1',
      width: `${b.offsetWidth}px`,
      height: `${b.offsetHeight}px`,
      transform: `translate(${b.offsetLeft}px, ${b.offsetTop}px)`,
    })
    if (first) requestAnimationFrame(() => this.thumb.classList.remove('no-transition'))
  }
}
