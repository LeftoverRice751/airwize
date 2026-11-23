import { useEffect, useMemo, useRef, useState } from 'react'
import { TopBar, type View } from './shell/TopBar'
import { ProvinceStrip } from './features/ProvinceStrip'
import { MunicipalityTable, type SortKey } from './features/MunicipalityTable'
import { DetailPanel } from './features/DetailPanel'
import { AlertsView } from './features/AlertsView'
import { FilterGroup, FilterPill } from './ui/FilterPill'
import { Button } from './ui/Button'
import { Notice } from './ui/Notice'
import { useNow, useReadings, useUrlParam } from './lib/hooks'
import { LEVELS, levelRank } from './lib/levels'
import { evaluate, loadRules, saveRules } from './lib/alerts'
import { fmtIndex } from './lib/format'
import type { AlertRule } from './lib/types'

export default function App() {
  const { snapshot, status, error, refreshing, refresh } = useReadings()
  const now = useNow()
  const [view, setView] = useUrlParam('view', 'monitor')
  const [level, setLevel] = useUrlParam('level', 'all')
  const [sort, setSort] = useUrlParam('sort', 'index')
  const [selected, setSelected] = useUrlParam('m', '')
  const [rules, setRules] = useState<AlertRule[]>(loadRules)

  useEffect(() => saveRules(rules), [rules])

  const data = status === 'ready' && snapshot?.updated_at ? snapshot.municipalities : null
  const firstPassPending = status === 'ready' && !snapshot?.updated_at

  const rows = useMemo(() => {
    if (!data) return null
    const filtered = level === 'all' ? data : data.filter((m) => m.level === level)
    return [...filtered].sort((a, b) => (sort === 'name' ? a.city.localeCompare(b.city) : b.plume_index - a.plume_index))
  }, [data, level, sort])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    data?.forEach((m) => c.set(m.level, (c.get(m.level) ?? 0) + 1))
    return c
  }, [data])

  const current = data ? (data.find((m) => m.city === selected) ?? rows?.[0]) : null

  // Triggered-rule tally, and a browser notification when a rule newly triggers.
  const triggeredIds = useMemo(() => {
    const byCity = new Map((data ?? []).map((m) => [m.city, m]))
    return rules.filter((r) => evaluate(r, byCity.get(r.city)).kind === 'triggered').map((r) => r.id)
  }, [data, rules])
  const notified = useRef<Set<string>>(new Set())
  useEffect(() => {
    const fresh = triggeredIds.filter((id) => !notified.current.has(id))
    notified.current = new Set(triggeredIds)
    if (!fresh.length || !('Notification' in window) || Notification.permission !== 'granted') return
    fresh.forEach((id) => {
      const r = rules.find((x) => x.id === id)
      const m = data?.find((x) => x.city === r?.city)
      if (r && m) new Notification(`${r.city} reached ${fmtIndex(m.plume_index)}`, { body: `Your alert threshold is ${r.threshold}. ${m.advice}`, tag: id })
    })
  }, [triggeredIds, rules, data])

  // In the stacked layout the detail panel sits below the ledger; bring it into view on selection.
  const selectMunicipality = (city: string) => {
    setSelected(city)
    if (window.matchMedia('(max-width: 80rem)').matches) {
      requestAnimationFrame(() => document.getElementById('detail-title')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
    }
  }

  const saveRule = (r: AlertRule) => setRules((rs) => (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [...rs, r]))

  const updatedAt = snapshot?.updated_at ? new Date(snapshot.updated_at) : null

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <TopBar view={view as View} onNavigate={setView} updatedAt={updatedAt} now={now} refreshing={refreshing} onRefresh={() => void refresh()} triggered={triggeredIds.length} />
      <main id="main" className="container main">
        {status === 'error' && (
          <Notice tone="error" title="Readings are unavailable" action={<Button variant="secondary" onClick={() => void refresh()}>Try again</Button>}>
            {error} Start the scraper with <code>go run . -serve :8080</code> in the webscraper folder.
          </Notice>
        )}
        {firstPassPending && (
          <Notice title="Collecting the first readings" action={<Button variant="secondary" loading={refreshing} onClick={() => void refresh()}>Check again</Button>}>
            The scraper is scanning every Philippine city page for Laguna. The first pass takes about 30 seconds.
          </Notice>
        )}
        {status === 'ready' && data && (snapshot?.error || error) && (
          <p className="stale" role="status">
            Some readings may be out of date. {error ?? 'The last scrape pass had failures.'}
          </p>
        )}

        {view === 'alerts' ? (
          <AlertsView data={data} rules={rules} onSave={saveRule} onRemove={(id) => setRules((rs) => rs.filter((r) => r.id !== id))} onRestore={saveRule} />
        ) : (
          status !== 'error' &&
          !firstPassPending && (
            <>
              <div className="view-head">
                <h1>Air quality in Laguna</h1>
                <p className="muted">Live Plume Labs readings{data ? ` for ${data.length} municipalities` : ''}, with each one’s 24-hour forecast.</p>
              </div>
              <ProvinceStrip data={data} rules={rules} />
              <div className="toolbar">
                <FilterGroup label="Filter by level">
                  <FilterPill selected={level === 'all'} onSelect={() => setLevel('all')} count={data?.length}>
                    All
                  </FilterPill>
                  {LEVELS.filter((l) => counts.has(l.key) || levelRank(l.key) <= 3).map((l) => (
                    <FilterPill key={l.key} selected={level === l.key} onSelect={() => setLevel(l.key)} count={data ? (counts.get(l.key) ?? 0) : undefined}>
                      {l.label}
                    </FilterPill>
                  ))}
                </FilterGroup>
              </div>
              <div className="workspace">
                {rows && rows.length === 0 ? (
                  <Notice title="No municipality is at this level right now" action={<Button variant="secondary" onClick={() => setLevel('all')}>Show all</Button>} />
                ) : data && data.length === 0 ? (
                  <Notice title="No Laguna municipalities found">The last scan returned none. Check that Plume Labs still lists Laguna cities, then refresh.</Notice>
                ) : (
                  <MunicipalityTable rows={rows} selected={current?.city ?? ''} onSelect={selectMunicipality} sort={sort as SortKey} onSort={(k) => setSort(k)} />
                )}
                <DetailPanel m={current} onSaveRule={saveRule} />
              </div>
            </>
          )
        )}
      </main>
      <footer className="container footer">
        <p className="muted">
          Data from <a href="https://air.plumelabs.com/air-quality/Philippines">Plume Labs</a>, scraped every 5 minutes. Index bands: excellent under 20, fair under 50, poor under 100, unhealthy under 150.
        </p>
      </footer>
    </>
  )
}
