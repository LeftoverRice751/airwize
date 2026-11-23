/**
 * Plume Labs index bands. Each band maps to one muted severity token
 * (--color-sev-1 … --color-sev-6 in tokens.css); components never pick colours.
 */
export interface Level {
  key: string
  label: string
  min: number
}

export const LEVELS: readonly Level[] = [
  { key: 'excellent', label: 'Excellent', min: 0 },
  { key: 'fair', label: 'Fair', min: 20 },
  { key: 'poor', label: 'Poor', min: 50 },
  { key: 'unhealthy', label: 'Unhealthy', min: 100 },
  { key: 'very unhealthy', label: 'Very unhealthy', min: 150 },
  { key: 'dangerous', label: 'Dangerous', min: 250 },
]

/** 1-based severity rank for a level key from the API, 0 if unknown. */
export function levelRank(key: string): number {
  return LEVELS.findIndex((l) => l.key === key) + 1
}

/** 1-based severity rank for a raw index value. */
export function rankForIndex(pi: number): number {
  let rank = 1
  LEVELS.forEach((l, i) => {
    if (pi >= l.min) rank = i + 1
  })
  return rank
}

export function levelLabel(rank: number): string {
  return LEVELS[rank - 1]?.label ?? 'Unknown'
}

/** Index thresholds worth offering as alert presets. */
export const ALERT_PRESETS = LEVELS.slice(1, 4)
