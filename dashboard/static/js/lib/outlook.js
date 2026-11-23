/**
 * Forecast analysis. Every figure here is derived from Plume Labs' own hourly
 * forecast for the municipality; nothing is estimated beyond that series.
 * The forecast covers the previous 24 hours and the next 24 hours.
 */
import { fromUnix, localHour } from './format.js'

export function splitForecast(m) {
  const nowTs = Date.parse(m.measured_at) / 1000
  const series = m.forecast ?? []
  return {
    past: series.filter((p) => p.timestamp <= nowTs),
    future: series.filter((p) => p.timestamp > nowTs),
  }
}

export const peak = (points) => points.reduce((best, p) => (!best || p.plume_index > best.plume_index ? p : best), undefined)

/** The daytime window (06:00–19:00 Manila) of `hours` consecutive points with the lowest mean index. */
export function bestWindow(points, hours = 3) {
  let best
  for (let i = 0; i + hours <= points.length; i++) {
    const win = points.slice(i, i + hours)
    const hr = localHour(fromUnix(win[0].timestamp))
    if (hr < 6 || hr + hours > 19) continue
    const mean = win.reduce((sum, p) => sum + p.plume_index, 0) / hours
    if (!best || mean < best.mean) best = { start: win[0], end: win[hours - 1], mean }
  }
  return best
}

/** Compares the index six hours ahead with the current reading. */
export function sixHourTrend(m) {
  const ahead = splitForecast(m).future[5]
  if (!ahead) return undefined
  const delta = ahead.plume_index - m.plume_index
  return { trend: delta >= 5 ? 'rising' : delta <= -5 ? 'easing' : 'steady', delta }
}

/** Pollutant with the highest sub-index, i.e. the one driving the overall index. */
export function dominantPollutant(m) {
  let key
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
export function dayAgo(m) {
  const { past } = splitForecast(m)
  return past.length >= 25 ? past[past.length - 25].plume_index : undefined
}
