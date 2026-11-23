import type { ForecastPoint } from '../lib/types'

/** The next 24 hours as one line, on a scale shared by every row so rows compare. */
export function Sparkline({ points, max, width = 96, height = 28 }: { points: ForecastPoint[]; max: number; width?: number; height?: number }) {
  if (points.length < 2) return <span className="muted">n/a</span>
  const step = width / (points.length - 1)
  const y = (v: number) => height - 2 - (v / max) * (height - 4)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(p.plume_index).toFixed(1)}`).join('')
  const hi = points.reduce((a, b) => (b.plume_index > a.plume_index ? b : a))
  const lo = points.reduce((a, b) => (b.plume_index < a.plume_index ? b : a))
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Next 24 hours: low ${Math.round(lo.plume_index)}, high ${Math.round(hi.plume_index)}`}>
      <path d={d} />
    </svg>
  )
}
