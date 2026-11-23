/**
 * Polls the Flask proxy for the Go scraper's snapshot. The scraper refreshes
 * upstream every few minutes; the browser asks once a minute by default.
 *
 * State passed to onChange:
 *   status: 'loading' | 'error' | 'ready'  ('ready' sticks once data arrived)
 *   snapshot: last good snapshot (schema: Snapshot in webscraper/main.go)
 *   error: message of the latest failure, or null
 *   refreshing: a request is in flight
 */
export class ReadingsPoller {
  constructor(url, intervalMs, onChange) {
    this.url = url
    this.intervalMs = intervalMs
    this.onChange = onChange
    this.state = { status: 'loading', snapshot: null, error: null, refreshing: false }
    this.ctrl = null
  }

  start() {
    void this.load()
    window.setInterval(() => void this.load(), this.intervalMs)
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  async load() {
    this.ctrl?.abort()
    const c = new AbortController()
    this.ctrl = c
    this.set({ refreshing: true })
    try {
      const res = await fetch(this.url, { signal: c.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(await errorMessage(res))
      const snapshot = await res.json()
      this.set({ snapshot, error: null, status: 'ready' })
    } catch (e) {
      if (e.name === 'AbortError') return
      const message = e instanceof TypeError ? 'The dashboard server could not be reached.' : e.message || 'The readings service could not be reached.'
      this.set({ error: message, status: this.state.status === 'ready' ? 'ready' : 'error' })
    } finally {
      if (this.ctrl === c) this.set({ refreshing: false })
    }
  }
}

/** The Flask proxy answers {"error": "..."} when the scraper is down. */
async function errorMessage(res) {
  try {
    const body = await res.json()
    if (body && typeof body.error === 'string') return body.error
  } catch {
    /* not JSON */
  }
  return `The readings service answered ${res.status}.`
}
