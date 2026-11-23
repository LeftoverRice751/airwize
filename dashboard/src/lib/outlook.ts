import type { ForecastPoint, Municipality } from './types'
import { localHour, fromUnix } from './format'

/**
 * Forecast analysis. Every figure here is derived from Plume Labs' own hourly
 * forecast for the municipality; nothing is estimated beyond that series.
 */

export function splitForecast(m: Municipality): { past: ForecastPoint[]; future: ForecastPoint[] } {
  const nowTs = Date.parse(m.measured_at) / 1000
  const series = m.forecast ?? []
  return {
    past: series.filter((p) => p.timestamp <= nowTs),
    future: series.filter((p) => p.timestamp > nowTs),
  }
}

export function peak(points: ForecastPoint[]): ForecastPoint | undefined {
  return points.reduce<ForecastPoint | undefined>((best, p) => (!best || p.plume_index > best.plume_index ? p : best), undefined)
}

/** The daytime window (06:00–19:00 Manila) of `hours` consecutive points with the lowest mean index. */
export function bestWindow(points: ForecastPoint[], hours = 3): { start: ForecastPoint; end: ForecastPoint; mean: number } | undefined {
  let best: { start: ForecastPoint; end: ForecastPoint; mean: number } | undefined
  for (let i = 0; i + hours <= points.length; i++) {
    const win = points.slice(i, i + hours)
    const h = localHour(fromUnix(win[0].timestamp))
    if (h < 6 || h + hours > 19) continue
    const mean = win.reduce((s, p) => s + p.plume_index, 0) / hours
    if (!best || mean < best.mean) best = { start: win[0], end: win[hours - 1], mean }
  }
  return best
}

export type Trend = 'rising' | 'easing' | 'steady'

/** Compares the index six hours ahead with the current reading. */
export function sixHourTrend(m: Municipality): { trend: Trend; delta: number } | undefined {
  const { future } = splitForecast(m)
  const ahead = future[5]
  if (!ahead) return undefined
  const delta = ahead.plume_index - m.plume_index
  return { trend: delta >= 5 ? 'rising' : delta <= -5 ? 'easing' : 'steady', delta }
}

/** Pollutant with the highest sub-index, i.e. the one driving the overall index. */
export function dominantPollutant(m: Municipality): string | undefined {
  let key: string | undefined
  let max = -Infinity
  for (const [k, v] of Object.entries(m.pollutants ?? {})) {
    if (v.pi > max) {
      max = v.pi
      key = k
    }
  }
  return key
}

/** Index 24 hours before the current reading, from the series' past half. */
export function dayAgo(m: Municipality): number | undefined {
  const { past } = splitForecast(m)
  return past.length >= 25 ? past[past.length - 25].plume_index : undefined
}
