/**
 * App shell header. The markup is rendered by templates/partials/topbar.html;
 * this class wires it up and keeps it in sync with app state. Navigation lives
 * in an accessible off-canvas sidebar on every screen size.
 */
import { replay } from '../lib/dom.js'
import { relativeMinutes } from '../lib/format.js'

const STALE_MS = 15 * 60_000

export class TopBar {
  constructor(root, { onNavigate, onSearch, onToggleTheme }) {
    this.root = root
    this.bar = root.querySelector('.topbar')
    this.layer = root.querySelector('#nav-layer')
    this.sidebar = root.querySelector('#nav-sidebar')
    this.burger = root.querySelector('[data-action="menu"]')
    this.navs = [...root.querySelectorAll('[data-nav]')]
    this.lastTriggered = 0
    this.open = false

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
    root.querySelectorAll('[data-kbd-mod]').forEach((k) => (k.textContent = `${isMac ? '⌘' : 'Ctrl'} K`))

    root.querySelectorAll('.nav__link').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault()
        onNavigate(a.dataset.view)
        this.setOpen(false)
      }),
    )
    root.querySelectorAll('[data-action="search"]').forEach((b) => b.addEventListener('click', onSearch))
    root.querySelectorAll('[data-action="theme"]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect()
        onToggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      }),
    )
    this.burger.addEventListener('click', () => this.setOpen(!this.open))
    root.querySelectorAll('[data-action="menu-close"]').forEach((b) => b.addEventListener('click', () => this.setOpen(false)))
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.setOpen(false)
    })
    this.sidebar.addEventListener('keydown', (e) => this.trapFocus(e))

    const onScroll = () => this.bar.classList.toggle('is-scrolled', window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    const ro = new ResizeObserver(() => this.placeIndicators())
    this.navs.forEach((n) => ro.observe(n))
    this.setOpen(false)
  }

  setOpen(open) {
    const wasOpen = this.open
    this.open = open
    this.layer.classList.toggle('is-open', open)
    this.layer.setAttribute('aria-hidden', String(!open))
    this.sidebar.inert = !open
    this.sidebar.setAttribute('aria-hidden', String(!open))
    document.body.classList.toggle('nav-open', open)
    this.burger.setAttribute('aria-expanded', String(open))
    this.burger.querySelector('.burger').classList.toggle('is-open', open)
    this.burger.querySelector('.visually-hidden').textContent = open ? 'Close navigation' : 'Open navigation'
    if (open) {
      requestAnimationFrame(() => {
        this.placeIndicators()
        this.sidebar.querySelector('[aria-current="page"]')?.focus()
      })
    } else if (wasOpen) {
      this.burger.focus()
    }
  }

  trapFocus(e) {
    if (e.key !== 'Tab') return
    const focusable = [...this.sidebar.querySelectorAll('a[href], button:not(:disabled)')]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  update({ view, updatedAt, now, connected, triggered, theme }) {
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
    const live = Boolean(connected && updatedAt && !stale)
    this.root.querySelectorAll('[data-live]').forEach((el) => {
      el.classList.toggle('live--stale', Boolean(updatedAt) && !live)
      el.classList.toggle('live--idle', !updatedAt)
      el.querySelector('[data-live-text]').textContent = live
        ? 'Live'
        : updatedAt
          ? `Updated ${relativeMinutes(updatedAt, now)}`
          : connected
            ? 'Connected · collecting'
            : 'Connecting…'
      el.title = live
        ? `WebSocket connected. Latest snapshot received ${relativeMinutes(updatedAt, now)}.`
        : connected
          ? 'WebSocket connected; waiting for the first scraper result.'
          : updatedAt
            ? `WebSocket disconnected. Showing data updated ${relativeMinutes(updatedAt, now)}.`
            : 'Connecting to the readings WebSocket.'
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
