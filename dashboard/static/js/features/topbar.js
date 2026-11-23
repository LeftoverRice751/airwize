/**
 * App shell header. The markup is rendered by templates/partials/topbar.html;
 * this class wires it up and keeps it in sync with app state. Under 40rem the
 * links and status fold into a sheet behind the menu button.
 */
import { replay } from '../lib/dom.js'
import { relativeMinutes } from '../lib/format.js'

const STALE_MS = 15 * 60_000

export class TopBar {
  constructor(root, { onNavigate, onRefresh, onSearch, onToggleTheme }) {
    this.root = root
    this.sheet = root.querySelector('#topbar-panel')
    this.burger = root.querySelector('[data-action="menu"]')
    this.navs = [...root.querySelectorAll('[data-nav]')]
    this.lastTriggered = 0

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
    root.querySelectorAll('[data-kbd-mod]').forEach((k) => (k.textContent = `${isMac ? '⌘' : 'Ctrl'} K`))

    root.querySelectorAll('.nav__link').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault()
        onNavigate(a.dataset.view)
        this.setOpen(false)
      }),
    )
    root.querySelectorAll('[data-action="refresh"]').forEach((b) => b.addEventListener('click', onRefresh))
    root.querySelectorAll('[data-action="search"]').forEach((b) => b.addEventListener('click', onSearch))
    root.querySelectorAll('[data-action="theme"]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect()
        onToggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      }),
    )
    this.burger.addEventListener('click', () => this.setOpen(!this.open))

    const onScroll = () => root.classList.toggle('is-scrolled', window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    const ro = new ResizeObserver(() => this.placeIndicators())
    this.navs.forEach((n) => ro.observe(n))
    this.setOpen(false)
  }

  setOpen(open) {
    this.open = open
    this.sheet.classList.toggle('is-open', open)
    this.burger.setAttribute('aria-expanded', String(open))
    this.burger.querySelector('.burger').classList.toggle('is-open', open)
    this.burger.querySelector('.visually-hidden').textContent = open ? 'Close menu' : 'Open menu'
    // The closed sheet stays in the DOM for its animation; keep it out of the tab order.
    this.sheet.inert = !open
    if (open) requestAnimationFrame(() => this.placeIndicators())
  }

  update({ view, updatedAt, now, refreshing, triggered, theme }) {
    this.view = view
    this.root.querySelectorAll('.nav__link').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })

    this.root.querySelectorAll('[data-triggered]').forEach((c) => {
      c.hidden = triggered === 0
      c.textContent = String(triggered)
      c.setAttribute('aria-label', `${triggered} triggered`)
      if (triggered > 0 && this.lastTriggered === 0) replay(c, 'pop-in')
    })
    this.lastTriggered = triggered

    const stale = updatedAt ? now.getTime() - updatedAt.getTime() > STALE_MS : false
    this.root.querySelectorAll('[data-live]').forEach((el) => {
      el.classList.toggle('live--stale', stale)
      el.classList.toggle('live--idle', !updatedAt)
      el.querySelector('[data-live-text]').textContent = updatedAt ? `Updated ${relativeMinutes(updatedAt, now)}` : 'Waiting for first reading'
    })

    this.root.querySelectorAll('[data-action="refresh"]').forEach((b) => {
      b.disabled = refreshing
      if (refreshing) b.setAttribute('aria-busy', 'true')
      else b.removeAttribute('aria-busy')
      b.querySelector('.refresh-icon').classList.toggle('spin', refreshing)
    })

    const next = theme === 'dark' ? 'light' : 'dark'
    this.root.querySelectorAll('[data-action="theme"]').forEach((b) => b.setAttribute('aria-label', `Switch to ${next} theme`))

    this.placeIndicators()
  }

  /** Slide each nav's single indicator under the current link. */
  placeIndicators() {
    for (const nav of this.navs) {
      const ind = nav.querySelector('.nav__ind')
      const link = nav.querySelector(`.nav__link[data-view="${this.view}"]`)
      if (!link || !link.offsetWidth) continue
      const first = !ind.style.width
      ind.classList.toggle('no-transition', first)
      Object.assign(ind.style, { width: `${link.offsetWidth}px`, height: `${link.offsetHeight}px`, transform: `translate(${link.offsetLeft}px, ${link.offsetTop}px)` })
    }
  }
}
