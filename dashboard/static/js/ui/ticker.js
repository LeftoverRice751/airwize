/**
 * A number that glides to its new value on a spring. The animated text is
 * hidden from assistive tech; a visually hidden copy holds the final value.
 */
import { h, cx } from '../lib/dom.js'
import { animateSpring, spring } from '../lib/motion.js'

const round = (n) => Math.round(n).toString()

export class NumberTicker {
  constructor({ className, format = round, fromZero = false } = {}) {
    this.format = format
    this.shown = h('span', { 'aria-hidden': 'true' })
    this.label = h('span', { class: 'visually-hidden' })
    this.el = h('span', { class: cx('num ticker', className) }, this.shown, this.label)
    this.current = fromZero ? 0 : null
    this.target = null
    this.stop = () => {}
  }

  set(value, format = this.format) {
    const formatChanged = format !== this.format
    this.format = format
    this.label.textContent = format(value)
    if (value === this.target && !formatChanged) return
    this.target = value
    this.stop()
    if (this.current === null) {
      this.paint(value)
      return
    }
    this.stop = animateSpring(this.current, value, spring.value, (v) => this.paint(v))
  }

  paint(v) {
    this.current = v
    this.shown.textContent = this.format(v)
  }
}
