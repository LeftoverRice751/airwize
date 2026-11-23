import type { AlertRule, Municipality } from '../lib/types'
import { dayAgo, peak, splitForecast } from '../lib/outlook'
import { evaluate } from '../lib/alerts'
import { fmtDayTime, fmtIndex, fromUnix } from '../lib/format'
import { levelLabel, rankForIndex } from '../lib/levels'
import { Stat } from '../ui/Stat'
import { Skeleton } from '../ui/Skeleton'

/**
 * Province-wide figures that appear nowhere else on the screen: the coming peak
 * across every municipality, the day-on-day change of the mean, and alert load.
 */
export function ProvinceStrip({ data, rules }: { data: Municipality[] | null; rules: AlertRule[] }) {
  if (!data) {
    return (
      <dl className="strip" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div className="stat" key={i}>
            <Skeleton w="9rem" h="0.9rem" />
            <Skeleton w="5rem" h="1.8rem" />
            <Skeleton w="11rem" h="0.9rem" />
          </div>
        ))}
      </dl>
    )
  }

  const peaks = data
    .map((m) => ({ m, p: peak(splitForecast(m).future) }))
    .filter((x): x is { m: Municipality; p: NonNullable<typeof x.p> } => !!x.p)
    .sort((a, b) => b.p.plume_index - a.p.plume_index)
  const top = peaks[0]

  const pairs = data.map((m) => ({ now: m.plume_index, then: dayAgo(m) })).filter((x): x is { now: number; then: number } => x.then !== undefined)
  const meanNow = pairs.reduce((s, x) => s + x.now, 0) / (pairs.length || 1)
  const meanThen = pairs.reduce((s, x) => s + x.then, 0) / (pairs.length || 1)
  const delta = Math.round(meanNow - meanThen)

  const byCity = new Map(data.map((m) => [m.city, m]))
  const statuses = rules.map((r) => evaluate(r, byCity.get(r.city)))
  const now = statuses.filter((s) => s.kind === 'triggered').length
  const soon = statuses.filter((s) => s.kind === 'forecast').length

  return (
    <dl className="strip">
      <Stat
        label="Province peak, next 24 hours"
        value={top ? <span className="num">{fmtIndex(top.p.plume_index)}</span> : 'n/a'}
        detail={top ? `${top.m.city}, ${fmtDayTime(fromUnix(top.p.timestamp))}, ${levelLabel(rankForIndex(top.p.plume_index)).toLowerCase()}` : 'No forecast available'}
      />
      <Stat
        label="Mean index against 24 hours ago"
        value={pairs.length ? <span className="num">{delta > 0 ? `+${delta}` : delta}</span> : 'n/a'}
        detail={pairs.length ? `Now ${fmtIndex(meanNow)}, was ${fmtIndex(meanThen)}, across ${pairs.length} municipalities` : 'Not enough history yet'}
      />
      <Stat
        label="Alerts triggered"
        value={<span className="num">{rules.length ? `${now} of ${rules.length}` : '0'}</span>}
        detail={rules.length ? (soon ? `${soon} more forecast to cross within 24 hours` : 'None forecast to cross within 24 hours') : 'No alert rules yet'}
      />
    </dl>
  )
}
