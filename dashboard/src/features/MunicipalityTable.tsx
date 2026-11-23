import type { Municipality } from '../lib/types'
import { levelRank } from '../lib/levels'
import { POLLUTANT_ORDER, fmtConc, fmtIndex, pollutantName } from '../lib/format'
import { splitForecast } from '../lib/outlook'
import { cx } from '../lib/cx'
import { LevelBadge } from '../ui/LevelBadge'
import { Skeleton } from '../ui/Skeleton'
import { Icon } from '../ui/Icon'
import { Sparkline } from './Sparkline'

export type SortKey = 'index' | 'name'

/** Width of the index bar is the index against this ceiling (top of "unhealthy"). */
const BAR_CEILING = 150

export interface MunicipalityTableProps {
  rows: Municipality[] | null
  selected: string
  onSelect: (city: string) => void
  sort: SortKey
  onSort: (k: SortKey) => void
}

/** The ledger: one row per municipality, sortable, selecting a row opens its detail. */
export function MunicipalityTable({ rows, selected, onSelect, sort, onSort }: MunicipalityTableProps) {
  const sparkMax = Math.max(60, ...(rows ?? []).flatMap((m) => splitForecast(m).future.map((p) => p.plume_index)))

  const sortHead = (key: SortKey, label: string, cls?: string) => (
    <th scope="col" className={cls} aria-sort={sort === key ? (key === 'index' ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => onSort(key)}>
        {label}
        <Icon name="sort" size={14} className={cx('th-sort__icon', sort === key && 'is-active')} />
      </button>
    </th>
  )

  return (
    <div className="ledger">
      <table className="table">
        <caption className="visually-hidden">Current air quality by municipality. Concentrations in micrograms per cubic metre.</caption>
        <thead>
          <tr>
            {sortHead('name', 'Municipality')}
            {sortHead('index', 'Index', 'num-col')}
            <th scope="col">Level</th>
            {POLLUTANT_ORDER.map((k) => (
              <th scope="col" key={k} className="num-col col-pollutant">
                {pollutantName(k)}
              </th>
            ))}
            <th scope="col" className="col-spark">
              Next 24 hours
            </th>
          </tr>
        </thead>
        <tbody>
          {rows === null
            ? Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="row--skeleton" aria-hidden="true">
                  <td><Skeleton w="8rem" /></td>
                  <td><Skeleton w="4rem" /></td>
                  <td><Skeleton w="4.5rem" /></td>
                  {POLLUTANT_ORDER.map((k) => (
                    <td key={k} className="col-pollutant"><Skeleton w="2.5rem" /></td>
                  ))}
                  <td className="col-spark"><Skeleton w="6rem" h="1.5rem" /></td>
                </tr>
              ))
            : rows.map((m) => {
                const isSel = m.city === selected
                return (
                  <tr key={m.city} className={cx('row', isSel && 'is-selected')} onClick={() => onSelect(m.city)}>
                    <th scope="row" className="cell-name">
                      <button type="button" className="row__select" aria-pressed={isSel} onClick={(e) => { e.stopPropagation(); onSelect(m.city) }}>
                        {m.city}
                      </button>
                      <span className="cell-sub">{m.municipality}</span>
                    </th>
                    <td className="num-col" data-label="Index">
                      <span className="index-cell">
                        <span className="num index-cell__value">{fmtIndex(m.plume_index)}</span>
                        <span className="index-bar" aria-hidden="true">
                          <span className={cx('index-bar__fill', `sev-${levelRank(m.level)}`)} style={{ transform: `scaleX(${Math.min(1, m.plume_index / BAR_CEILING)})` }} />
                        </span>
                      </span>
                    </td>
                    <td data-label="Level">
                      <LevelBadge rank={levelRank(m.level)} />
                    </td>
                    {POLLUTANT_ORDER.map((k) => (
                      <td key={k} className="num-col col-pollutant num" data-label={pollutantName(k)}>
                        {fmtConc(m.pollutants?.[k]?.value_upm)}
                      </td>
                    ))}
                    <td className="col-spark" data-label="Next 24 hours">
                      <Sparkline points={splitForecast(m).future} max={sparkMax} />
                    </td>
                  </tr>
                )
              })}
        </tbody>
      </table>
    </div>
  )
}
