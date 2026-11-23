/**
 * Live mode: polls Flask's GET /api/energy/live while the Energy tab is open
 * in live mode. Flask talks to the solar system's Wi-Fi module through an
 * adapter (webapp/services/energy_device.py); this file never contacts a
 * device directly and never invents values.
 *
 * State passed to onChange:
 *   state     'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'not_configured'
 *   source    description of the device, from the adapter, or null
 *   message   why it is not connected, or null
 *   reading   the latest reading while connected, otherwise null
 *   history   every distinct reading received this session (for the chart)
 *   checkedAt when the last answer arrived
 */
const MAX_HISTORY = 2_000

export class LiveEnergy {
  constructor(url, intervalMs, onChange) {
    this.url = url
    this.intervalMs = intervalMs
    this.onChange = onChange
    this.state = { state: 'idle', source: null, message: null, reading: null, history: [], checkedAt: null }
    this.timer = null
    this.ctrl = null
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  get running() {
    return this.timer !== null
  }

  start() {
    if (this.running) return
    this.timer = window.setInterval(() => this.poll(), this.intervalMs)
    this.poll()
  }

  stop() {
    window.clearInterval(this.timer)
    this.timer = null
    this.ctrl?.abort()
  }

  /** "Connect" / "Try again": ask right away. */
  connect() {
    if (!this.running) return this.start()
    this.poll()
  }

  async poll() {
    this.ctrl?.abort()
    const c = new AbortController()
    this.ctrl = c
    if (this.state.state !== 'connected') this.set({ state: 'connecting' })
    try {
      const res = await fetch(this.url, { signal: c.signal, cache: 'no-store' })
      const body = await res.json()
      if (!res.ok || typeof body?.state !== 'string') throw new Error(body?.message || `The dashboard answered ${res.status}.`)
      const reading = body.state === 'connected' ? body.reading : null
      this.set({ state: body.state, source: body.source ?? null, message: body.message ?? null, reading, history: this.append(reading), checkedAt: new Date() })
    } catch (e) {
      if (e.name === 'AbortError') return
      const message = e instanceof TypeError ? 'The dashboard server could not be reached.' : e.message
      this.set({ state: 'error', message, reading: null, checkedAt: new Date() })
    }
  }

  append(reading) {
    const h = this.state.history
    if (!reading) return h
    const t = reading.measured_at ? new Date(reading.measured_at) : new Date()
    if (h.length && h.at(-1).time.getTime() === t.getTime()) return h
    return [...h, { ...reading, time: t }].slice(-MAX_HISTORY)
  }
}

/**
 * Drain from the live charge history: needs two readings at least five
 * minutes apart. Returns %/h (positive = draining) or null.
 */
export function liveDrainRate(history, lookbackMin = 30) {
  const withCharge = history.filter((p) => typeof p.charge_pct === 'number')
  if (withCharge.length < 2) return null
  const last = withCharge.at(-1)
  const cutoff = last.time.getTime() - lookbackMin * 60_000
  const first = withCharge.find((p) => p.time.getTime() >= cutoff) ?? withCharge[0]
  const hours = (last.time - first.time) / 3_600_000
  if (hours < 5 / 60) return null
  return (first.charge_pct - last.charge_pct) / hours
}

/** The live load about `minutes` ago, if the history reaches back that far. */
export function liveLoadAgo(history, minutes) {
  const last = history.at(-1)
  if (!last) return null
  const target = last.time.getTime() - minutes * 60_000
  let best = null
  for (const p of history) {
    if (typeof p.load_w !== 'number') continue
    if (p.time.getTime() <= target) best = p
  }
  return best && target - best.time.getTime() < minutes * 60_000 ? best.load_w : null
}
