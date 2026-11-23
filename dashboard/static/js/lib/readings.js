/**
 * Keeps the dashboard synchronized with the scraper over WebSocket. The
 * HTTP endpoint remains available for the user's manual Refresh action.
 *
 * State passed to onChange:
 *   status: 'loading' | 'error' | 'ready'  ('ready' sticks once data arrived)
 *   snapshot: last good snapshot (schema: Snapshot in webscraper/main.go)
 *   error: message of the latest failure, or null
 *   refreshing: a manual HTTP request is in flight
 *   connected: true only after a valid snapshot arrives over WebSocket
 */
export class ReadingsStream {
  constructor(readingsUrl, websocketUrl, onChange) {
    this.readingsUrl = readingsUrl
    this.websocketUrl = websocketUrl
    this.onChange = onChange
    this.state = { status: 'loading', snapshot: null, error: null, refreshing: false, connected: false }
    this.ctrl = null
    this.socket = null
    this.retryTimer = null
    this.retryCount = 0
    this.stopped = true
  }

  start() {
    this.stopped = false
    this.connect()
    window.addEventListener('online', () => this.reconnectNow())
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  connect() {
    if (this.stopped || this.socket) return
    let socket
    try {
      socket = new WebSocket(this.websocketUrl)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      try {
        const snapshot = JSON.parse(event.data)
        if (!snapshot || !Array.isArray(snapshot.municipalities)) throw new Error('Invalid readings snapshot')
        this.retryCount = 0
        this.set({ snapshot, error: null, status: 'ready', connected: true })
      } catch {
        this.set({ error: 'The readings service sent an invalid real-time update.', status: this.state.snapshot ? 'ready' : 'error', connected: false })
        socket.close()
      }
    })
    socket.addEventListener('error', () => socket.close())
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.scheduleReconnect()
    })
  }

  scheduleReconnect() {
    if (this.stopped || this.retryTimer) return
    const delay = Math.min(1000 * 2 ** this.retryCount, 30_000)
    this.retryCount += 1
    this.set({
      error: 'The real-time connection was lost. Reconnecting automatically…',
      status: this.state.snapshot ? 'ready' : 'error',
      connected: false,
    })
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  reconnectNow() {
    if (this.retryTimer) window.clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retryCount = 0
    if (!this.socket) this.connect()
  }

  refresh() {
    this.reconnectNow()
    void this.load()
  }

  async load() {
    this.ctrl?.abort()
    const c = new AbortController()
    this.ctrl = c
    this.set({ refreshing: true })
    try {
      const res = await fetch(this.readingsUrl, { signal: c.signal, cache: 'no-store' })
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
