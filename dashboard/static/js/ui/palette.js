/**
 * Keyboard-first jump list (Ctrl/Cmd+K or /). Type to filter, arrows to move,
 * Enter to run, Esc to close. Focus returns to whatever had it before opening.
 *
 * A command: { id, group, label, keywords?, icon?, hint?: () => Node, run }
 */
import { cx, h, icon, nextId, reducedMotion } from '../lib/dom.js'

const score = (c, q) => {
  if (!q) return 1
  const label = c.label.toLowerCase()
  if (label.startsWith(q)) return 3
  if (label.includes(q)) return 2
  return `${label} ${c.keywords ?? ''}`.toLowerCase().includes(q) ? 1 : 0
}

export class CommandPalette {
  constructor({ getCommands }) {
    this.getCommands = getCommands
    this.id = nextId('cmdk')
    this.isOpen = false
    this.active = 0
    this.flat = []
    this.returnTo = null

    this.input = h('input', {
      class: 'cmdk__input',
      placeholder: 'Search municipalities or actions',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': `${this.id}-list`,
      'aria-autocomplete': 'list',
      spellcheck: 'false',
      autocomplete: 'off',
      oninput: () => {
        this.active = 0
        this.renderList()
      },
      onkeydown: (e) => this.onKey(e),
    })
    this.hl = h('span', { class: 'cmdk__hl', 'aria-hidden': 'true' })
    this.list = h('div', { id: `${this.id}-list`, class: 'cmdk__list', role: 'listbox', 'aria-label': 'Results' })
    this.dialog = h(
      'div',
      { class: 'cmdk', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search municipalities and actions' },
      h('div', { class: 'cmdk__search' }, icon('search', 18), this.input, h('kbd', { class: 'kbd' }, 'Esc')),
      this.list,
      h(
        'div',
        { class: 'cmdk__foot', 'aria-hidden': 'true' },
        h('span', {}, h('kbd', { class: 'kbd' }, '↑'), h('kbd', { class: 'kbd' }, '↓'), ' Move'),
        h('span', {}, h('kbd', { class: 'kbd' }, icon('enter', 12)), ' Open'),
      ),
    )
    this.layer = h('div', { class: 'cmdk-layer', hidden: true }, h('div', { class: 'cmdk-scrim', 'aria-hidden': 'true', onclick: () => this.close() }), this.dialog)
    document.body.append(this.layer)
  }

  toggle() {
    this.isOpen ? this.close() : this.open()
  }

  open() {
    if (this.isOpen) return
    this.isOpen = true
    this.returnTo = document.activeElement
    this.input.value = ''
    this.active = 0
    this.renderList()
    this.layer.hidden = false
    this.layer.classList.remove('is-leaving')
    requestAnimationFrame(() => this.input.focus())
  }

  close() {
    if (!this.isOpen) return
    this.isOpen = false
    const done = () => {
      if (!this.isOpen) this.layer.hidden = true
    }
    this.layer.classList.add('is-leaving')
    if (reducedMotion()) done()
    else window.setTimeout(done, 150)
    if (this.returnTo instanceof HTMLElement) this.returnTo.focus()
  }

  /** Re-read commands while open (e.g. after a poll brought new readings). */
  refresh() {
    if (this.isOpen) this.renderList()
  }

  results() {
    const q = this.input.value.trim().toLowerCase()
    return this.getCommands()
      .map((c, i) => ({ c, s: score(c, q), i }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.c)
  }

  renderList() {
    // Group in result order, keeping a flat index for keyboard movement.
    const groups = []
    this.results().forEach((c) => {
      let g = groups.find((x) => x.name === c.group)
      if (!g) groups.push((g = { name: c.group, items: [] }))
      g.items.push(c)
    })
    this.flat = groups.flatMap((g) => g.items)
    this.active = Math.min(this.active, Math.max(0, this.flat.length - 1))

    let index = 0
    const nodes = groups.map((g) =>
      h(
        'div',
        { role: 'group', 'aria-label': g.name, class: 'cmdk__group' },
        h('p', { class: 'cmdk__group-label', 'aria-hidden': 'true' }, g.name),
        g.items.map((c) => {
          const i = index++
          return h(
            'div',
            {
              id: `${this.id}-${i}`,
              role: 'option',
              class: 'cmdk__item',
              dataset: { index: i },
              onpointermove: () => this.setActive(i, false),
              onclick: () => this.run(c),
            },
            c.icon && icon(c.icon, 16, { className: 'cmdk__icon' }),
            h('span', { class: 'cmdk__label' }, c.label),
            c.hint && h('span', { class: 'cmdk__hint' }, c.hint()),
          )
        }),
      ),
    )
    const empty = this.flat.length === 0 && h('p', { class: 'cmdk__empty' }, `No municipality or action matches “${this.input.value}”.`)
    this.list.replaceChildren(this.hl, ...(empty ? [empty] : nodes))
    this.setActive(this.active, true, true)
  }

  setActive(i, scroll = true, jump = false) {
    this.active = i
    const items = this.list.querySelectorAll('.cmdk__item')
    items.forEach((el, j) => {
      el.setAttribute('aria-selected', String(j === i))
      el.classList.toggle('is-active', j === i)
    })
    const el = items[i]
    if (el) this.input.setAttribute('aria-activedescendant', el.id)
    else this.input.removeAttribute('aria-activedescendant')

    // One highlight that slides between items.
    this.hl.hidden = !el
    if (!el) return
    this.hl.classList.toggle('no-transition', jump)
    Object.assign(this.hl.style, { width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px`, transform: `translate(${el.offsetLeft}px, ${el.offsetTop}px)` })
    if (scroll) el.scrollIntoView({ block: 'nearest' })
  }

  run(c) {
    if (!c) return
    this.close()
    c.run()
  }

  onKey(e) {
    if (e.key === 'ArrowDown') this.setActive(Math.min(this.flat.length - 1, this.active + 1))
    else if (e.key === 'ArrowUp') this.setActive(Math.max(0, this.active - 1))
    else if (e.key === 'Enter') this.run(this.flat[this.active])
    else if (e.key === 'Escape') this.close()
    else if (e.key === 'Tab') {
      /* keep focus in the input */
    } else return
    e.preventDefault()
  }
}

export const cmdkLevelHint = (rankClass, value, word) => () =>
  h('span', { class: cx('cmdk__level', rankClass) }, h('span', { class: 'badge__dot', 'aria-hidden': 'true' }), h('span', { class: 'num' }, value), ` ${word}`)
