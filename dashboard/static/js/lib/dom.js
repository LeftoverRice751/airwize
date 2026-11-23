/**
 * Tiny DOM helpers so components read like markup without a framework.
 *
 *   h('button', { class: 'btn', onclick: go, 'aria-label': 'Go' }, 'Go')
 *
 * Attributes: `class`, `text`, `style` (object), `dataset` (object), `on<event>`
 * (function), anything else is set with setAttribute. null/false are skipped,
 * `true` sets an empty attribute.
 */
const SVG_NS = 'http://www.w3.org/2000/svg'

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') el.setAttribute('class', v)
    else if (k === 'text') el.textContent = v
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag)
  apply(el, attrs)
  append(el, children)
  return el
}

export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag)
  apply(el, attrs)
  append(el, children)
  return el
}

/** Stroke icon from the sprite in templates/partials/icons.html. Decorative. */
export function icon(name, size = 18, { className, strokeWidth = 1.7 } = {}) {
  return s(
    'svg',
    {
      class: className,
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    s('use', { href: `#i-${name}` }),
  )
}

export const cx = (...parts) => parts.filter(Boolean).join(' ')

/** Replace all children of `el`. */
export function replace(el, ...children) {
  el.replaceChildren()
  append(el, children)
}

/** Placeholder block in the shape of the content that is loading. */
export const skeleton = (w = '100%', hgt = '1em') => h('span', { class: 'skeleton', style: { width: w, height: hgt }, 'aria-hidden': 'true' })

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Restart a CSS animation class on an element. */
export function replay(el, className) {
  el.classList.remove(className)
  void el.offsetWidth // force reflow so the animation starts again
  el.classList.add(className)
}

let uid = 0
/** Unique id prefix for label/aria wiring. */
export const nextId = (prefix = 'id') => `${prefix}-${++uid}`
