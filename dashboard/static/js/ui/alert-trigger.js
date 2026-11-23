/**
 * Creates or edits one threshold rule: "alert when the index reaches N".
 * The same form serves the detail panel (fixed city) and the alerts view
 * (choose a city from a select).
 *
 *   const form = new AlertTrigger({ withSelect: true, onSubmit, onCancel })
 *   form.setOptions(['Calamba', ...]); form.edit(rule); form.setCity('Biñan')
 */
import { h, icon, nextId, replay } from '../lib/dom.js'
import { ALERT_PRESETS } from '../lib/levels.js'
import { newRuleId } from '../lib/alerts.js'
import { toast } from './toast.js'
import { button } from './primitives.js'
import { Segmented } from './segmented.js'

const MIN = 1
const MAX = 500
const DEFAULT = 50

export class AlertTrigger {
  constructor({ withSelect = false, onSubmit, onCancel }) {
    const id = nextId('trigger')
    this.onSubmit = onSubmit
    this.onCancel = onCancel
    this.city = ''
    this.initial = null
    this.error = ''

    this.select = withSelect ? h('select', { id: `${id}-city`, name: 'city', class: 'input', onchange: () => (this.city = this.select.value) }) : null

    this.input = h('input', {
      id: `${id}-threshold`,
      name: 'threshold',
      class: 'stepper__input num',
      type: 'number',
      inputmode: 'numeric',
      min: MIN,
      max: MAX,
      value: DEFAULT,
      'aria-describedby': `${id}-help`,
      oninput: () => {
        this.setError('')
        this.sync()
      },
    })
    this.down = h('button', { type: 'button', class: 'stepper__btn', 'aria-label': 'Lower by 5', onclick: () => this.step(-5) }, icon('minus', 14))
    this.up = h('button', { type: 'button', class: 'stepper__btn', 'aria-label': 'Raise by 5', onclick: () => this.step(5) }, icon('plus', 14))
    this.stepper = h('div', { class: 'stepper' }, this.down, this.input, this.up)

    this.presets = new Segmented({
      label: 'Threshold presets',
      size: 'sm',
      onChange: (key) => {
        const l = ALERT_PRESETS.find((x) => x.key === key)
        if (!l) return
        this.input.value = String(l.min)
        this.setError('')
        this.sync()
      },
    })

    this.help = h('p', { class: 'help', id: `${id}-help`, 'aria-live': 'polite' })
    this.submitBtn = button({ variant: 'primary', type: 'submit', label: 'Save alert', iconName: 'bell' })
    this.cancelBtn = onCancel ? button({ variant: 'ghost', label: 'Cancel', onClick: () => this.onCancel() }) : null
    if (this.cancelBtn) this.cancelBtn.hidden = true

    this.el = h(
      'form',
      { class: 'trigger', novalidate: true, onsubmit: (e) => this.submit(e) },
      this.select &&
        h(
          'div',
          { class: 'field' },
          h('label', { for: `${id}-city` }, 'Municipality'),
          h('div', { class: 'select' }, this.select, icon('sort', 14, { className: 'select__icon' })),
        ),
      h('div', { class: 'field' }, h('label', { for: `${id}-threshold` }, 'Alert when the index reaches'), this.stepper),
      this.presets.el,
      this.help,
      h('div', { class: 'trigger__actions' }, this.submitBtn, this.cancelBtn),
    )
    this.sync()
  }

  get value() {
    return Number(this.input.value)
  }

  /** Detail-panel mode: the form is about one fixed municipality. Resets on change. */
  setCity(city) {
    if (city === this.city) return
    this.city = city
    this.reset()
  }

  /** Select mode: refresh the municipality list, keeping the current choice. */
  setOptions(cities) {
    if (!this.select) return
    const same = cities.length === this.select.options.length && cities.every((c, i) => this.select.options[i].value === c)
    if (!same) this.select.replaceChildren(...cities.map((c) => h('option', { value: c }, c)))
    if (!cities.includes(this.city)) this.city = cities[0] ?? ''
    this.select.value = this.city
    this.sync()
  }

  /** Load a rule for editing, or pass null to go back to a new rule. */
  edit(rule) {
    this.initial = rule
    if (rule) this.city = rule.city
    else if (this.select) this.city = this.select.options[0]?.value ?? ''
    if (this.select) this.select.value = this.city
    this.reset()
  }

  reset() {
    this.input.value = String(this.initial?.threshold ?? DEFAULT)
    this.setError('')
    this.sync()
  }

  step(d) {
    const n = this.value
    const base = Number.isFinite(n) ? n : DEFAULT
    this.input.value = String(Math.min(MAX, Math.max(MIN, Math.round(base) + d)))
    this.setError('')
    this.sync()
  }

  setError(msg) {
    this.error = msg
    if (msg) {
      this.stepper.dataset.invalid = ''
      this.input.setAttribute('aria-invalid', 'true')
      this.help.dataset.error = ''
    } else {
      delete this.stepper.dataset.invalid
      this.input.removeAttribute('aria-invalid')
      delete this.help.dataset.error
    }
    this.help.textContent = msg || 'Presets are where each band starts.'
  }

  /** Reflect the current value in the buttons and presets. */
  sync() {
    const n = this.value
    this.down.disabled = n <= MIN
    this.up.disabled = n >= MAX
    this.submitBtn.disabled = !this.city
    this.submitBtn.lastChild.textContent = this.initial ? 'Update alert' : 'Save alert'
    if (this.cancelBtn) this.cancelBtn.hidden = !this.initial
    const preset = ALERT_PRESETS.find((l) => l.min === n)?.key ?? null
    this.presets.update(
      ALERT_PRESETS.map((l) => ({ value: l.key, label: l.label, count: l.min })),
      preset,
    )
  }

  submit(e) {
    e.preventDefault()
    const n = this.value
    if (this.input.value.trim() === '' || !Number.isFinite(n) || n < MIN || n > MAX) {
      this.setError(`Enter an index between ${MIN} and ${MAX}.`)
      replay(this.stepper, 'is-shaking')
      this.input.focus()
      return
    }
    this.setError('')
    const value = Math.round(n)
    const editing = this.initial
    this.onSubmit({ id: editing?.id ?? newRuleId(), city: this.city, threshold: value })
    toast(
      editing
        ? { tone: 'success', title: 'Alert updated', description: `${this.city} at ${value}` }
        : { tone: 'success', title: 'Alert saved', description: `You'll be alerted when ${this.city} reaches ${value}.` },
    )
  }
}
