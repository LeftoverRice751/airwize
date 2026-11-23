/**
 * Alert rules: "tell me when <city> reaches <threshold>". Rules are kept in
 * this browser's localStorage under the same key the React dashboard used, so
 * existing rules carry over.
 */
import { splitForecast } from './outlook.js'

const KEY = 'laguna-air.alerts'

export function loadRules() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveRules(rules) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules))
  } catch {
    /* storage unavailable (private mode); rules live for this session only */
  }
}

/** crypto.randomUUID needs a secure context; fall back when served over plain http on a LAN. */
export const newRuleId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Triggered now, forecast to cross within 24 hours, or clear.
 * Returns { kind: 'triggered', value } | { kind: 'forecast', value, at } |
 *         { kind: 'clear', peak } | { kind: 'no-data' }
 */
export function evaluate(rule, m) {
  if (!m) return { kind: 'no-data' }
  if (m.plume_index >= rule.threshold) return { kind: 'triggered', value: m.plume_index }
  const { future } = splitForecast(m)
  const first = future.find((p) => p.plume_index >= rule.threshold)
  if (first) return { kind: 'forecast', value: first.plume_index, at: first.timestamp }
  return { kind: 'clear', peak: Math.max(m.plume_index, ...future.map((p) => p.plume_index)) }
}
