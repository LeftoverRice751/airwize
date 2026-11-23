/**
 * "Energy optimization": suggestions from the provider configured on the
 * server (webapp/services/energy_optimization.py). By default that is the
 * "rules" provider, which reuses the Solar outlook's rules-based
 * recommendations. This panel generates nothing itself.
 *
 * When optimization_enabled is true it POSTs the context from
 * lib/energy/context.js to /api/energy/suggestions (at most once per
 * REQUEST_EVERY_MS, or right away when the site, mode or scenario changes) and
 * lists the returned {title, body, basis} items. With no provider configured
 * it stays an empty placeholder and makes no request. Swapping in an AI
 * provider needs no change here; its API key stays on the server.
 */
import { h } from '../../lib/dom.js'

const REQUEST_EVERY_MS = 60_000

export class OptimizationPanel {
  constructor({ url, enabled }) {
    this.url = url
    this.enabled = enabled
    this.lastKey = ''
    this.lastAt = 0
    this.ctrl = null

    this.status = h('span', { class: 'energy-tag' }, enabled ? 'Loading' : 'Not connected')
    this.list = h('ul', { class: 'energy-suggestions', hidden: true })
    this.placeholder = h(
      'div',
      { class: 'energy-placeholder' },
      h('p', {}, 'Suggestions for making the most of the available energy will appear here.'),
      h('p', { class: 'source-note' }, enabled ? 'Checking the current conditions…' : 'No optimization service is connected yet.'),
    )
    this.el = h(
      'section',
      { class: 'panel energy-optimization', id: 'energy-optimization', 'aria-labelledby': 'energy-optimization-title', 'aria-live': 'polite' },
      h('header', { class: 'energy-panel__head' }, h('h2', { id: 'energy-optimization-title' }, 'Energy optimization'), this.status),
      this.placeholder,
      this.list,
    )
  }

  /** `key` identifies the site/mode/scenario so a change asks again at once. */
  update(context, key) {
    if (!this.enabled) return
    const now = Date.now()
    if (key === this.lastKey && now - this.lastAt < REQUEST_EVERY_MS) return
    this.lastKey = key
    this.lastAt = now
    void this.request(context)
  }

  async request(context) {
    this.ctrl?.abort()
    const c = new AbortController()
    this.ctrl = c
    try {
      const res = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(context), signal: c.signal })
      const body = await res.json()
      this.render(body)
    } catch (e) {
      if (e.name !== 'AbortError') this.render({ status: 'error', suggestions: [], message: 'The optimization service could not be reached.' })
    }
  }

  render({ status, label, suggestions = [], message }) {
    const has = status === 'ok' && suggestions.length > 0
    this.status.textContent = status === 'ok' ? (label ?? 'Suggestions') : status === 'error' ? 'Unavailable' : 'Not connected'
    this.placeholder.hidden = has
    this.placeholder.lastChild.textContent = message ?? (status === 'ok' ? 'No suggestions right now.' : '')
    this.list.hidden = !has
    this.list.replaceChildren(...suggestions.map((sg) => h('li', { class: 'energy-suggestion' }, h('p', { class: 'energy-suggestion__title' }, sg.title), h('p', { class: 'energy-suggestion__body' }, sg.body), sg.basis && h('p', { class: 'energy-why__basis' }, sg.basis))))
  }
}
