import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ForecastPoint } from '../lib/types'
import { LEVELS, levelLabel, rankForIndex } from '../lib/levels'
import { fmtDayTime, fmtIndex, fmtWeekday, fromUnix, localHour } from '../lib/format'
import { useWidth } from '../lib/hooks'

const H = 200

/** Midnight shows the weekday; other ticks show the hour. */
const tickLabel = (ts: number) => {
  const d = fromUnix(ts)
  const h = localHour(d)
  return h === 0 ? fmtWeekday(d) : `${String(h).padStart(2, '0')}:00`
}
const PAD = { top: 12, right: 8, bottom: 24, left: 28 }

/**
 * 48 hours of the index: the past 24 solid, the forecast 24 dashed, a rule at now,
 * and hairlines at the band thresholds. Pointer or arrow keys move the readout.
 */
export function ForecastChart({ points, nowTs }: { points: ForecastPoint[]; nowTs: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const nowIdx = Math.max(0, points.findLastIndex((p) => p.timestamp <= nowTs))
  const [cursor, setCursor] = useState<number | null>(null)
  const active = points[cursor ?? nowIdx]

  const geo = useMemo(() => {
    const w = Math.max(width, 240)
    const maxV = Math.max(60, ...points.map((p) => p.plume_index)) * 1.1
    const t0 = points[0]?.timestamp ?? 0
    const t1 = points[points.length - 1]?.timestamp ?? 1
    const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (w - PAD.left - PAD.right)
    const y = (v: number) => PAD.top + (1 - v / maxV) * (H - PAD.top - PAD.bottom)
    const line = (ps: ForecastPoint[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(1)},${y(p.plume_index).toFixed(1)}`).join('')
    const past = points.slice(0, nowIdx + 1)
    const future = points.slice(nowIdx)
    const area = `${line(points)}L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z`
    const bands = LEVELS.filter((l) => l.min > 0 && l.min < maxV)
    // Label spacing of at least ~56px: every 6, 12 or 24 hours depending on width.
    const pxPerHour = (w - PAD.left - PAD.right) / Math.max(1, (t1 - t0) / 3600)
    const step = [6, 12, 24].find((h) => h * pxPerHour >= 56) ?? 24
    const ticks = points.filter((p) => localHour(fromUnix(p.timestamp)) % step === 0)
    return { w, x, y, area, pastD: line(past), futureD: line(future), bands, ticks }
  }, [points, width, nowIdx])

  if (points.length < 2) return null

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(geo.x(p.timestamp) - px) < Math.abs(geo.x(points[best].timestamp) - px)) best = i
    })
    setCursor(best)
  }
  const keys = (e: KeyboardEvent) => {
    const cur = cursor ?? nowIdx
    if (e.key === 'ArrowRight') setCursor(Math.min(points.length - 1, cur + 1))
    else if (e.key === 'ArrowLeft') setCursor(Math.max(0, cur - 1))
    else if (e.key === 'Home') setCursor(0)
    else if (e.key === 'End') setCursor(points.length - 1)
    else return
    e.preventDefault()
  }

  const ax = geo.x(active.timestamp)
  const isForecast = active.timestamp > nowTs
  return (
    <figure className="chart">
      <figcaption className="chart__readout" aria-live="polite">
        <span className="chart__when">{cursor === null || cursor === nowIdx ? 'Now' : fmtDayTime(fromUnix(active.timestamp))}</span>
        <span className="chart__value num">{fmtIndex(active.plume_index)}</span>
        <span className="chart__level">{levelLabel(rankForIndex(active.plume_index))}</span>
        {isForecast && <span className="chart__kind">forecast</span>}
      </figcaption>
      <div ref={ref} className="chart__frame">
        <svg
          width={geo.w}
          height={H}
          viewBox={`0 0 ${geo.w} ${H}`}
          tabIndex={0}
          role="img"
          aria-label="Plume index over the past 24 hours and the next 24 hours. Use the left and right arrow keys to read hourly values."
          onPointerMove={pick}
          onPointerLeave={() => setCursor(null)}
          onKeyDown={keys}
          onBlur={() => setCursor(null)}
        >
          {geo.bands.map((b) => (
            <g key={b.key} className="chart__band">
              <line x1={PAD.left} x2={geo.w - PAD.right} y1={geo.y(b.min)} y2={geo.y(b.min)} />
              <text x={PAD.left - 6} y={geo.y(b.min)} dy="0.32em" textAnchor="end">
                {b.min}
              </text>
            </g>
          ))}
          <path className="chart__area" d={geo.area} />
          <path className="chart__past" d={geo.pastD} />
          <path className="chart__future" d={geo.futureD} />
          <line className="chart__now" x1={geo.x(nowTs)} x2={geo.x(nowTs)} y1={PAD.top} y2={H - PAD.bottom} />
          {geo.ticks.map((t) => (
            <text key={t.timestamp} className="chart__tick" x={geo.x(t.timestamp)} y={H - 6} textAnchor="middle">
              {tickLabel(t.timestamp)}
            </text>
          ))}
          <line className="chart__cursor" x1={ax} x2={ax} y1={PAD.top} y2={H - PAD.bottom} />
          <circle className="chart__dot" cx={ax} cy={geo.y(active.plume_index)} r={3.5} />
        </svg>
      </div>
      <p className="chart__legend">
        <span className="legend legend--past">Past 24 hours</span>
        <span className="legend legend--future">Forecast, next 24 hours</span>
      </p>
    </figure>
  )
}
