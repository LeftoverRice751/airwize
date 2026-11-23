/**
 * Light/dark theme. The inline script in index.html applies the stored or
 * system theme before first paint; this module changes it afterwards.
 */
import { reducedMotion } from './dom.js'

const KEY = 'laguna-air.theme'

export const getTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** Follow the system setting until the visitor makes a choice. */
export function followSystem(onChange) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', () => {
    let stored = null
    try {
      stored = localStorage.getItem(KEY)
    } catch {
      /* storage blocked */
    }
    if (stored) return
    document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'
    onChange()
  })
}

/** Persist and apply a theme, revealing it as a circle growing from `origin`. */
export function setTheme(theme, origin, onApplied) {
  const apply = () => {
    document.documentElement.dataset.theme = theme
    onApplied?.()
  }
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage blocked */
  }

  if (!document.startViewTransition || reducedMotion()) return apply()

  const x = origin?.x ?? window.innerWidth - 40
  const y = origin?.y ?? 32
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  const vt = document.startViewTransition(apply)
  vt.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
    .catch(() => {})
}
