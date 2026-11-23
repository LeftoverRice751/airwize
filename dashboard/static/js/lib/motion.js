/**
 * Shared motion vocabulary, replacing the `motion` library the React version
 * used. Most transitions are plain CSS (see css/motion.css); JS springs drive
 * only values CSS cannot interpolate: tickers and the forecast chart morph.
 * Everything collapses to an instant jump under prefers-reduced-motion.
 */
import { reducedMotion } from './dom.js'

export const spring = {
  /** Chart geometry morphing between municipalities. */
  chart: { stiffness: 170, damping: 26, mass: 1 },
  /** Values that should glide (tickers). */
  value: { stiffness: 140, damping: 24, mass: 1 },
}

/**
 * Animate a number from `from` to `to` on a damped spring, calling
 * `onUpdate(v)` each frame. Returns a function that stops it.
 */
export function animateSpring(from, to, { stiffness, damping, mass }, onUpdate, onDone) {
  if (reducedMotion() || from === to) {
    onUpdate(to)
    onDone?.()
    return () => {}
  }
  let x = from
  let v = 0
  let last = performance.now()
  let raf = 0
  const restDelta = Math.max(Math.abs(to - from) * 0.0005, 0.005)
  const tick = (t) => {
    const dt = Math.min(0.032, (t - last) / 1000)
    last = t
    // Semi-implicit Euler in small steps keeps stiff springs stable.
    for (let i = 0; i < 4; i++) {
      const a = (-stiffness * (x - to) - damping * v) / mass
      v += a * (dt / 4)
      x += v * (dt / 4)
    }
    if (Math.abs(v) < restDelta * 10 && Math.abs(x - to) < restDelta) {
      onUpdate(to)
      onDone?.()
      return
    }
    onUpdate(x)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

/**
 * FLIP: record positions of `els`, run `mutate` (which reorders the DOM), then
 * slide each element from its old position to its new one.
 */
export function flip(els, mutate, duration = 360) {
  if (reducedMotion()) return mutate()
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect().top]))
  mutate()
  for (const [el, top] of before) {
    if (!el.isConnected) continue
    const dy = top - el.getBoundingClientRect().top
    if (!dy) continue
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
  }
}
