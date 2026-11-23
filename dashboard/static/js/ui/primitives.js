/** Small stateless building blocks shared by every screen. */
import { cx, h, icon } from '../lib/dom.js'
import { levelLabel } from '../lib/levels.js'

/**
 * The single button primitive. One `primary` per view; `secondary` is outlined,
 * `ghost` is typographic, `icon` is a square hit target with a hidden label.
 */
export function button({ variant = 'secondary', size = 'md', label, iconName, iconSize = 15, loading = false, disabled = false, type = 'button', onClick, className, attrs = {} }) {
  return h(
    'button',
    {
      type,
      class: cx('btn', `btn--${variant}`, size === 'sm' && 'btn--sm', className),
      disabled: disabled || loading,
      'aria-busy': loading ? 'true' : null,
      onclick: onClick,
      ...attrs,
    },
    iconName && icon(iconName, iconSize),
    variant === 'icon' ? h('span', { class: 'visually-hidden' }, label) : label,
  )
}

/** Inline message for empty and error states, with at most one action. */
export function notice({ tone = 'neutral', title, body, action }) {
  return h(
    'div',
    { class: cx('notice', tone === 'error' && 'notice--error'), role: tone === 'error' ? 'alert' : 'status' },
    h('span', { class: 'notice__icon', 'aria-hidden': 'true' }, icon(tone === 'error' ? 'alert' : 'info', 18)),
    h(
      'div',
      { class: 'notice__content' },
      h('p', { class: 'notice__title' }, title),
      body && h('p', { class: 'notice__body' }, body),
      action && h('div', { class: 'notice__action' }, action),
    ),
  )
}

/** Severity label with a tinted dot. The word carries the meaning; the dot only echoes it. */
export const levelBadge = (rank, size = 'md') =>
  h('span', { class: cx('badge', `sev-${rank}`, size === 'lg' && 'badge--lg') }, h('span', { class: 'badge__dot', 'aria-hidden': 'true' }), levelLabel(rank))
