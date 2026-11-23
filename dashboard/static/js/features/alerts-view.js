/**
 * Alerts view: a form to create or edit rules, the browser-notification
 * opt-in, and the list of rules with their live status. Rules are keyed by id
 * and updated in place so focus survives each poll; reorders slide (FLIP).
 * The surrounding markup lives in templates/index.html.
 */
import { cx, h, reducedMotion } from '../lib/dom.js'
import { evaluate } from '../lib/alerts.js'
import { fmtDayTime, fmtIndex, fromUnix } from '../lib/format.js'
import { flip } from '../lib/motion.js'
import { button, notice } from '../ui/primitives.js'
import { AlertTrigger } from '../ui/alert-trigger.js'
import { toast } from '../ui/toast.js'

const STATUS_WORD = { triggered: 'Triggered', forecast: 'Forecast', clear: 'Clear', 'no-data': 'No data' }
const ORDER = { triggered: 0, forecast: 1, clear: 2, 'no-data': 3 }

function statusText(st) {
  switch (st.kind) {
    case 'triggered':
      return `Triggered, index ${fmtIndex(st.value)} now`
    case 'forecast':
      return `Forecast to reach ${fmtIndex(st.value)} at ${fmtDayTime(fromUnix(st.at))}`
    case 'clear':
      return `Clear, 24-hour high ${fmtIndex(st.peak)}`
    default:
      return 'No reading for this municipality'
  }
}

const permission = () => ('Notification' in window ? Notification.permission : 'unsupported')

export class AlertsView {
  constructor(root, { onSave, onRemove, onRestore, onChange }) {
    this.onRemove = onRemove
    this.onRestore = onRestore
    this.onChange = onChange // re-render request (e.g. after a permission prompt)
    this.editing = null
    this.items = new Map() // rule id -> parts

    this.formPanel = root.querySelector('#rule-form')
    this.formTitle = root.querySelector('#rule-form-title')
    this.formSlot = root.querySelector('[data-slot="rule-form"]')
    this.permSlot = root.querySelector('[data-slot="permission"]')
    this.count = root.querySelector('[data-slot="rule-count"]')
    this.listSlot = root.querySelector('[data-slot="rules"]')

    this.trigger = new AlertTrigger({
      withSelect: true,
      onSubmit: (r) => {
        onSave(r)
        if (this.editing) this.setEditing(null)
      },
      onCancel: () => this.setEditing(null),
    })
    this.noCities = h('p', { class: 'muted' }, 'Municipalities appear here once the first reading arrives.')
    this.list = h('ul', { class: 'rules' })
    this.empty = notice({
      title: 'No alert rules yet',
      body: 'Choose a municipality and a threshold. The rule shows as triggered when the index reaches it, and as forecast when the next 24 hours will.',
    })
    this.perm = permission()
    this.permShown = null
  }

  setEditing(rule) {
    this.editing = rule
    this.trigger.edit(rule)
    this.render()
  }

  update(data, rules) {
    this.data = data
    this.rules = rules
    if (this.editing && !rules.some((r) => r.id === this.editing.id)) this.setEditing(null)
    else this.render()
  }

  render() {
    const data = this.data ?? []
    const rules = this.rules ?? []
    const cities = data.map((m) => m.city).sort()

    this.formPanel.classList.toggle('panel--editing', !!this.editing)
    this.formTitle.textContent = this.editing ? `Edit alert for ${this.editing.city}` : 'New alert'
    const formNode = cities.length ? this.trigger.el : this.noCities
    if (this.formSlot.firstChild !== formNode) this.formSlot.replaceChildren(formNode)
    if (cities.length) this.trigger.setOptions(cities)

    this.renderPermission()

    this.count.textContent = String(rules.length)
    const byCity = new Map(data.map((m) => [m.city, m]))
    const rows = rules
      .map((r) => ({ r, st: evaluate(r, byCity.get(r.city)) }))
      .sort((a, b) => ORDER[a.st.kind] - ORDER[b.st.kind] || a.r.city.localeCompare(b.r.city))
    this.renderRules(rows)
  }

  renderPermission() {
    const perm = this.perm
    if (perm === this.permShown) return
    this.permShown = perm
    if (perm === 'unsupported' || perm === 'granted') return this.permSlot.replaceChildren()
    this.permSlot.replaceChildren(
      h(
        'div',
        { class: 'perm' },
        h('p', { class: 'muted' }, perm === 'denied' ? 'Browser notifications are blocked for this site. Allow them in your browser settings to be notified.' : 'Get a browser notification when a rule is triggered.'),
        perm === 'default' &&
          button({
            variant: 'secondary',
            size: 'sm',
            label: 'Turn on notifications',
            iconName: 'bell',
            iconSize: 14,
            onClick: () =>
              void Notification.requestPermission().then((p) => {
                this.perm = p
                this.render()
                this.onChange?.()
              }),
          }),
      ),
    )
  }

  renderRules(rows) {
    if (rows.length === 0 && this.items.size === 0) {
      if (this.listSlot.firstChild !== this.empty) this.listSlot.replaceChildren(this.empty)
      return
    }
    if (this.listSlot.firstChild !== this.list) this.listSlot.replaceChildren(this.list)

    const wanted = new Set(rows.map((x) => x.r.id))
    for (const [id, it] of this.items) {
      if (!wanted.has(id) && !it.leaving) this.leave(id, it)
    }

    const ordered = rows.map(({ r, st }) => {
      let it = this.items.get(r.id)
      if (!it || it.leaving) {
        it?.li.remove()
        it = this.createItem(r)
        this.items.set(r.id, it)
      }
      this.fillItem(it, r, st)
      return it.li
    })

    const current = [...this.list.children].filter((li) => !li.classList.contains('is-leaving'))
    const same = current.length === ordered.length && current.every((li, i) => li === ordered[i])
    if (!same) flip(current, () => this.list.prepend(...ordered))
  }

  createItem(r) {
    const it = {
      dot: h('span', { class: 'rule__dot', 'aria-hidden': 'true' }),
      word: h('span'),
      city: h('span'),
      threshold: h('span', { class: 'num' }),
      status: h('p', { class: 'rule__status' }),
      rule: r,
    }
    it.state = h('span', { class: 'rule__state' }, it.dot, it.word)
    it.edit = button({ variant: 'ghost', size: 'sm', label: 'Edit', onClick: () => this.setEditing(it.rule) })
    it.remove = button({ variant: 'ghost', size: 'sm', label: 'Remove', onClick: () => this.remove(it.rule) })
    it.li = h(
      'li',
      { class: 'rule rule--enter' },
      it.state,
      h('div', { class: 'rule__main' }, h('p', { class: 'rule__title' }, it.city, ' ', h('span', { class: 'rule__at' }, 'at'), ' ', it.threshold), it.status),
      h('div', { class: 'rule__actions' }, it.edit, it.remove),
    )
    it.li.addEventListener('animationend', () => it.li.classList.remove('rule--enter'))
    return it
  }

  fillItem(it, r, st) {
    it.rule = r
    it.li.className = cx('rule', `rule--${st.kind}`, it.li.classList.contains('rule--enter') && 'rule--enter', this.editing?.id === r.id && 'is-editing')
    it.state.dataset.kind = st.kind
    it.word.textContent = STATUS_WORD[st.kind]
    it.city.textContent = r.city
    it.threshold.textContent = String(r.threshold)
    it.status.textContent = statusText(st)
    it.edit.setAttribute('aria-label', `Edit alert for ${r.city}`)
    it.remove.setAttribute('aria-label', `Remove alert for ${r.city}`)
  }

  /** Fade a removed rule out, then let the rest slide up. */
  leave(id, it) {
    it.leaving = true
    it.li.classList.add('is-leaving')
    const done = () => {
      if (this.items.get(id) === it) this.items.delete(id)
      const rest = [...this.list.children].filter((li) => li !== it.li)
      flip(rest, () => it.li.remove())
      if (this.items.size === 0) this.render()
    }
    if (reducedMotion()) done()
    else window.setTimeout(done, 160)
  }

  remove(r) {
    // Move focus somewhere stable before the row (and its button) disappears.
    this.formTitle.setAttribute('tabindex', '-1')
    this.formTitle.focus({ preventScroll: true })
    this.onRemove(r.id)
    if (this.editing?.id === r.id) this.setEditing(null)
    toast({ title: `Removed the alert for ${r.city}`, action: { label: 'Undo', onClick: () => this.onRestore(r) }, duration: 8000 })
  }
}
