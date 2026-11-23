/**
 * Bottom-right toast stack. Collapsed, older toasts tuck behind the newest;
 * hovering or focusing the stack fans them out and pauses their timers. Each
 * one can be swiped right to dismiss. Use for confirmations of something the
 * person just did:
 *
 *   toast({ title: 'Alert saved', description: '…', tone: 'success',
 *           action: { label: 'Undo', onClick }, duration: 8000 })
 */
import { h, icon, reducedMotion } from '../lib/dom.js'

const MAX_VISIBLE = 3
const GAP = 10
const HEIGHT = 64

const items = [] // newest last: { el, remaining, started, timer }
let list = null
let expanded = false

function ensureRoot() {
  if (list) return
  const root = document.getElementById('toaster')
  list = root.querySelector('.toaster__list')
  const setExpanded = (v) => {
    expanded = v
    layout()
    items.forEach((t) => (v ? pause(t) : resume(t)))
  }
  root.addEventListener('mouseenter', () => setExpanded(true))
  root.addEventListener('mouseleave', () => setExpanded(false))
  root.addEventListener('focusin', () => setExpanded(true))
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget)) setExpanded(false)
  })
}

function layout() {
  const visible = items.filter((t) => !t.leaving)
  visible.forEach((t, i) => {
    const depth = visible.length - 1 - i
    const y = expanded ? -depth * (HEIGHT + GAP) : -depth * 12
    const scale = expanded ? 1 : 1 - depth * 0.05
    t.el.style.zIndex = String(10 - depth)
    t.el.style.opacity = depth >= MAX_VISIBLE ? '0' : '1'
    t.el.style.transform = `translate(${t.dragX}px, ${y}px) scale(${scale})`
  })
}

function pause(t) {
  if (!t.timer) return
  window.clearTimeout(t.timer)
  t.timer = 0
  t.remaining -= Date.now() - t.started
}

function resume(t) {
  if (t.timer || t.leaving) return
  t.started = Date.now()
  t.timer = window.setTimeout(() => dismiss(t), Math.max(0, t.remaining))
}

function dismiss(t) {
  if (t.leaving) return
  t.leaving = true
  window.clearTimeout(t.timer)
  t.el.classList.add('is-leaving')
  const remove = () => {
    t.el.remove()
    items.splice(items.indexOf(t), 1)
  }
  if (reducedMotion()) remove()
  else window.setTimeout(remove, 160)
  layout()
}

/** Swipe right past 80px (or flick) to dismiss. */
function enableSwipe(t) {
  let startX = 0
  let startT = 0
  let dragging = false
  t.el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return
    dragging = true
    startX = e.clientX
    startT = performance.now()
    t.el.setPointerCapture(e.pointerId)
    t.el.classList.add('is-dragging')
  })
  t.el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - startX
    t.dragX = dx > 0 ? dx * 0.9 : dx * 0.05 // elastic to the left
    layout()
  })
  const end = (e) => {
    if (!dragging) return
    dragging = false
    t.el.classList.remove('is-dragging')
    const dx = e.clientX - startX
    const velocity = dx / Math.max(1, performance.now() - startT) // px per ms
    if (dx > 80 || velocity > 0.5) dismiss(t)
    t.dragX = 0
    layout()
  }
  t.el.addEventListener('pointerup', end)
  t.el.addEventListener('pointercancel', end)
}

export function toast({ title, description, tone = 'neutral', action, duration = 5000 }) {
  ensureRoot()
  const t = { remaining: duration, started: 0, timer: 0, leaving: false, dragX: 0 }
  t.el = h(
    'li',
    { class: 'toast is-entering', dataset: { tone } },
    h('span', { class: 'toast__icon', 'aria-hidden': 'true' }, icon(tone === 'success' ? 'check' : 'info', 16)),
    h('div', { class: 'toast__body' }, h('p', { class: 'toast__title' }, title), description && h('p', { class: 'toast__desc' }, description)),
    action &&
      h('button', {
        type: 'button',
        class: 'toast__action',
        text: action.label,
        onclick: () => {
          action.onClick()
          dismiss(t)
        },
      }),
    h('button', { type: 'button', class: 'toast__close', 'aria-label': 'Dismiss notification', onclick: () => dismiss(t) }, icon('close', 14)),
  )
  items.push(t)
  // Keep one hidden spare so the stack never grows unbounded.
  while (items.filter((x) => !x.leaving).length > MAX_VISIBLE + 1) dismiss(items.find((x) => !x.leaving))
  list.append(t.el)
  enableSwipe(t)
  layout()
  requestAnimationFrame(() => requestAnimationFrame(() => t.el.classList.remove('is-entering')))
  if (!expanded) resume(t)
}
