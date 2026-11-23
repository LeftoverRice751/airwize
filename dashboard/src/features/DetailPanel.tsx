import type { AlertRule, Municipality } from '../lib/types'
import { levelRank, levelLabel, rankForIndex } from '../lib/levels'
import { fmtDayTime, fmtIndex, fmtTime, fromUnix, pollutantName } from '../lib/format'
import { bestWindow, dominantPollutant, peak, sixHourTrend, splitForecast } from '../lib/outlook'
import { LevelBadge } from '../ui/LevelBadge'
import { AlertTrigger } from '../ui/AlertTrigger'
import { Skeleton } from '../ui/Skeleton'
import { Icon } from '../ui/Icon'
import { ForecastChart } from './ForecastChart'

const TREND_WORDS = { rising: 'Rising', easing: 'Easing', steady: 'Steady' } as const

export function DetailPanel({ m, onSaveRule }: { m: Municipality | undefined | null; onSaveRule: (r: AlertRule) => void }) {
  if (m === null) {
    return (
      <section className="panel" aria-busy="true" aria-label="Municipality detail">
        <Skeleton w="10rem" h="1.6rem" />
        <Skeleton w="14rem" />
        <Skeleton w="100%" h="200px" />
        <Skeleton w="100%" h="6rem" />
      </section>
    )
  }
  if (!m) return null

  const { future } = splitForecast(m)
  const nowTs = Date.parse(m.measured_at) / 1000
  const pk = peak(future)
  const win = bestWindow(future)
  const trend = sixHourTrend(m)
  const dom = dominantPollutant(m)
  const rank = levelRank(m.level)

  return (
    <section className="panel" aria-labelledby="detail-title">
      <header className="panel__head">
        <div>
          <h2 id="detail-title">{m.city}</h2>
          <p className="muted">
            {m.municipality}, {m.region}
          </p>
        </div>
        <a className="ext-link" href={m.url} target="_blank" rel="noreferrer">
          Source <Icon name="external" size={14} />
        </a>
      </header>

      <div className="advisory">
        <LevelBadge rank={rank} size="lg" />
        {m.advice && <p className="advisory__text">{m.advice}</p>}
        <p className="source-note">Reading for {fmtTime(new Date(m.measured_at))}, Manila time. Advice text from Plume Labs.</p>
      </div>

      {future.length > 0 && <ForecastChart points={m.forecast ?? []} nowTs={nowTs} />}

      <div className="panel__section">
        <h3>Forecast outlook</h3>
        <dl className="facts">
          <div>
            <dt>Peak, next 24 hours</dt>
            <dd>{pk ? <><span className="num">{fmtIndex(pk.plume_index)}</span> at {fmtDayTime(fromUnix(pk.timestamp))}, {levelLabel(rankForIndex(pk.plume_index)).toLowerCase()}</> : 'n/a'}</dd>
          </div>
          <div>
            <dt>Cleanest 3 daytime hours</dt>
            <dd>{win ? <>{fmtDayTime(fromUnix(win.start.timestamp))} to {fmtTime(fromUnix(win.end.timestamp + 3600))}, mean <span className="num">{fmtIndex(win.mean)}</span></> : 'No daytime hours in range'}</dd>
          </div>
          <div>
            <dt>Six-hour trend</dt>
            <dd>{trend ? <>{TREND_WORDS[trend.trend]}, <span className="num">{trend.delta > 0 ? '+' : ''}{fmtIndex(trend.delta)}</span></> : 'n/a'}</dd>
          </div>
          <div>
            <dt>Driving pollutant</dt>
            <dd>{dom ? `${pollutantName(dom)}, sub-index ${fmtIndex(m.pollutants[dom].pi)}` : 'n/a'}</dd>
          </div>
        </dl>
        <p className="source-note">Computed from the Plume Labs hourly forecast for {m.city}.</p>
      </div>

      <div className="panel__section">
        <h3>Conditions</h3>
        <dl className="facts facts--grid">
          <div>
            <dt>Temperature</dt>
            <dd><span className="num">{m.weather.temperature.toFixed(1)}</span> °C</dd>
          </div>
          <div>
            <dt>UV index</dt>
            <dd className="num">{m.weather.uv.toFixed(0)}</dd>
          </div>
          <div>
            <dt>Sky</dt>
            <dd>{m.weather.icon ? m.weather.icon[0].toUpperCase() + m.weather.icon.slice(1).replace(/[-_]/g, ' ') : 'n/a'}</dd>
          </div>
        </dl>
      </div>

      <div className="panel__section">
        <h3>Alert for {m.city}</h3>
        <AlertTrigger city={m.city} onSubmit={onSaveRule} />
      </div>
    </section>
  )
}
