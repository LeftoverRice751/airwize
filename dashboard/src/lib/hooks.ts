import { useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot } from './types'

export type LoadStatus = 'loading' | 'error' | 'ready'

/** Polls /api/readings. The scraper refreshes upstream every few minutes. */
export function useReadings(intervalMs = 60_000) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const ctrl = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setRefreshing(true)
    try {
      const res = await fetch('/api/readings', { signal: c.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`The readings service answered ${res.status}.`)
      const data = (await res.json()) as Snapshot
      setSnapshot(data)
      setError(null)
      setStatus('ready')
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message || 'The readings service could not be reached.')
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'))
    } finally {
      if (ctrl.current === c) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), intervalMs)
    return () => {
      window.clearInterval(id)
      ctrl.current?.abort()
    }
  }, [load, intervalMs])

  return { snapshot, status, error, refreshing, refresh: load }
}

/** One query-string parameter as React state, written with replaceState. */
export function useUrlParam(name: string, fallback = ''): [string, (v: string) => void] {
  const read = () => new URLSearchParams(window.location.search).get(name) ?? fallback
  const [value, setValue] = useState(read)

  useEffect(() => {
    const onPop = () => setValue(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = useCallback(
    (v: string) => {
      const params = new URLSearchParams(window.location.search)
      if (v === fallback || v === '') params.delete(name)
      else params.set(name, v)
      const qs = params.toString()
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
      setValue(v)
    },
    [name, fallback],
  )
  return [value, set]
}

/** Width of an element, for charts drawn at true pixel size. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Re-renders every `ms` so relative times stay current. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}
