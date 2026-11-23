import type { AlertRule, Municipality } from './types'
import { splitForecast } from './outlook'

const KEY = 'laguna-air.alerts'

export function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as AlertRule[]) : []
  } catch {
    return []
  }
}

export function saveRules(rules: AlertRule[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules))
  } catch {
    /* storage unavailable (private mode); rules live for this session only */
  }
}

export type AlertStatus =
  | { kind: 'triggered'; value: number }
  | { kind: 'forecast'; value: number; at: number }
  | { kind: 'clear'; peak: number }
  | { kind: 'no-data' }

/** Triggered now, forecast to cross within 24 hours, or clear. */
export function evaluate(rule: AlertRule, m: Municipality | undefined): AlertStatus {
  if (!m) return { kind: 'no-data' }
  if (m.plume_index >= rule.threshold) return { kind: 'triggered', value: m.plume_index }
  const { future } = splitForecast(m)
  const first = future.find((p) => p.plume_index >= rule.threshold)
  if (first) return { kind: 'forecast', value: first.plume_index, at: first.timestamp }
  return { kind: 'clear', peak: Math.max(m.plume_index, ...future.map((p) => p.plume_index)) }
}
