/**
 * Dashboard entry point. Mirrors the former App.tsx:
 *
 *   state  ── one plain object (readings, URL-backed view state, alert rules, theme)
 *             The Energy tab (features/energy/) keeps its own demo clock and live polling.
 *   derive ── filtered/sorted rows, selected municipality, triggered rules
 *   render ── hands each component its props; components update their own DOM
 *
 * Call set({...}) to change state; renders are batched to one per microtask.
 */
import { h } from './lib/dom.js'
import { fmtIndex } from './lib/format.js'
import { LEVELS, levelLabel, levelRank } from './lib/levels.js'
import { evaluate, loadRules, saveRules } from './lib/alerts.js'
import { ReadingsStream } from './lib/readings.js'
import { followSystem, getTheme, setTheme } from './lib/theme.js'
import { readUrl, writeUrl } from './lib/url-state.js'
import { button, notice } from './ui/primitives.js'
import { Segmented } from './ui/segmented.js'
import { CommandPalette, cmdkLevelHint } from './ui/palette.js'
import { TopBar } from './features/topbar.js'
import { ProvinceStrip } from './features/province-strip.js'
import { MunicipalityTable } from './features/municipality-table.js'
import { DetailPanel } from './features/detail-panel.js'
import { AlertsView } from './features/alerts-view.js'
import { EnergyView } from './features/energy/energy-view.js'
import { SITES } from './lib/energy/sites.js'
import { SCENARIOS } from './lib/energy/scenarios.js'
import { SolarCard } from './solar.js'

const config = JSON.parse(document.getElementById('client-config').textContent)

/* ---------- State ---------- */

const state = {
  readings: { status: 'loading', snapshot: null, error: null, refreshing: false, connected: false },
  ...readUrl(), // view, level, sort, m (selected municipality), site, mode, scenario (energy)
  rules: loadRules(),
  theme: getTheme(),
  now: new Date(),
}

let queued = false
function set(patch) {
  Object.assign(state, patch)
  writeUrl({ view: state.view, level: state.level, sort: state.sort, m: state.m, site: state.site, mode: state.mode, scenario: state.scenario })
  if ('rules' in patch) saveRules(state.rules)
  if (!queued) {
    queued = true
    queueMicrotask(() => {
      queued = false
      render()
    })
  }
}

const saveRule = (r) => set({ rules: state.rules.some((x) => x.id === r.id) ? state.rules.map((x) => (x.id === r.id ? r : x)) : [...state.rules, r] })
const removeRule = (id) => set({ rules: state.rules.filter((r) => r.id !== id) })

/* ---------- Derived values ---------- */

function derive() {
  const { status, snapshot } = state.readings
  const data = status === 'ready' && snapshot?.updated_at ? snapshot.municipalities : null
  const firstPassPending = status === 'ready' && !snapshot?.updated_at

  let rows = null
  if (data) {
    const filtered = state.level === 'all' ? data : data.filter((m) => m.level === state.level)
    rows = [...filtered].sort((a, b) => (state.sort === 'name' ? a.city.localeCompare(b.city) : b.plume_index - a.plume_index))
  }

  const counts = new Map()
  data?.forEach((m) => counts.set(m.level, (counts.get(m.level) ?? 0) + 1))

  const current = data ? (data.find((m) => m.city === state.m) ?? rows?.[0]) : null

  const byCity = new Map((data ?? []).map((m) => [m.city, m]))
  const triggeredIds = state.rules.filter((r) => evaluate(r, byCity.get(r.city)).kind === 'triggered').map((r) => r.id)

  return { data, firstPassPending, rows, counts, current, triggeredIds }
}

/* ---------- Actions ---------- */

const readingsStream = new ReadingsStream(config.readings_url, config.websocket_url, (readings) => set({ readings }))
const refresh = () => readingsStream.refresh()

/** In the stacked layout the detail panel sits below the ledger; bring it into view on selection. */
function selectMunicipality(city, forceScroll = false) {
  set({ m: city })
  if (forceScroll || window.matchMedia('(max-width: 80rem)').matches) {
    requestAnimationFrame(() =>
      document.getElementById('detail-title')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }),
    )
  }
}

const toggleTheme = (origin) => {
  const next = state.theme === 'dark' ? 'light' : 'dark'
  setTheme(next, origin, () => set({ theme: next }))
}

/* ---------- Components ---------- */

const topbar = new TopBar(document.querySelector('.topbar-shell'), {
  onNavigate: (view) => set({ view }),
  onSearch: () => palette.open(),
  onToggleTheme: toggleTheme,
})

const els = {
  notices: document.getElementById('notices'),
  view: document.getElementById('view'),
  monitor: document.getElementById('view-monitor'),
  alerts: document.getElementById('view-alerts'),
  energy: document.getElementById('view-energy'),
  monitorSub: document.getElementById('monitor-sub'),
  workspace: document.getElementById('workspace'),
  listSlot: document.getElementById('ledger-slot'),
}

const strip = new ProvinceStrip(document.getElementById('strip'))
const levelFilter = new Segmented({ label: 'Filter by level', onChange: (level) => set({ level }) })
document.getElementById('level-filter').append(levelFilter.el)

const table = new MunicipalityTable({ onSelect: (city) => selectMunicipality(city), onSort: (sort) => set({ sort }) })
const noRowsAtLevel = notice({ title: 'No municipality is at this level right now', action: button({ label: 'Show all', onClick: () => set({ level: 'all' }) }) })
const noMunicipalities = notice({ title: 'No Laguna municipalities found', body: 'The last scan returned none. Check that Plume Labs still lists Laguna cities, then refresh.' })

const detail = new DetailPanel({ onSaveRule: saveRule })
els.workspace.append(detail.el)

const solar = new SolarCard(document.getElementById('solar-view'), config.solar_forecast_url, config.poll_interval_ms)

const alerts = new AlertsView(els.alerts, {
  onSave: saveRule,
  onRemove: removeRule,
  onRestore: saveRule,
  onChange: () => set({}),
})

const energy = new EnergyView(els.energy, { config, onChange: (patch) => set(patch) })

const palette = new CommandPalette({ getCommands })

function getCommands() {
  const { data } = derive()
  const places = [...(data ?? [])]
    .sort((a, b) => a.city.localeCompare(b.city))
    .map((m) => ({
      id: `m-${m.city}`,
      group: 'Municipalities',
      label: m.city,
      keywords: `${m.municipality} ${m.level}`,
      icon: 'pin',
      hint: cmdkLevelHint(`sev-${levelRank(m.level)}`, fmtIndex(m.plume_index), levelLabel(levelRank(m.level)).toLowerCase()),
      run: () => {
        set({ view: 'monitor', level: state.level !== 'all' && m.level !== state.level ? 'all' : state.level })
        selectMunicipality(m.city, true)
      },
    }))
  const dark = state.theme === 'dark'
  return [
    ...places,
    { id: 'go-monitor', group: 'Actions', label: 'Go to monitor', icon: 'wind', run: () => set({ view: 'monitor' }) },
    { id: 'go-alerts', group: 'Actions', label: 'Go to alerts', icon: 'bell', run: () => set({ view: 'alerts' }) },
    { id: 'go-energy', group: 'Actions', label: 'Go to energy', icon: 'bolt', keywords: 'solar battery generator grid power', run: () => set({ view: 'energy' }) },
    ...Object.values(SITES).map((site) => ({ id: `site-${site.key}`, group: 'Energy', label: `Energy: ${site.label}`, icon: 'bolt', keywords: 'site type', run: () => set({ view: 'energy', site: site.key }) })),
    ...SCENARIOS.map((sc) => ({ id: `scenario-${sc.id}`, group: 'Energy', label: `Demo scenario: ${sc.label}`, icon: 'bolt', keywords: `simulation ${sc.description}`, run: () => set({ view: 'energy', mode: 'simulation', scenario: sc.id }) })),
    { id: 'refresh', group: 'Actions', label: 'Refresh readings', icon: 'refresh', run: refresh },
    { id: 'theme', group: 'Actions', label: dark ? 'Switch to light theme' : 'Switch to dark theme', icon: dark ? 'sun' : 'moon', keywords: 'dark light mode appearance', run: () => toggleTheme() },
  ]
}

/* ---------- Render ---------- */

let lastView = state.view
let noticeKey = ''
const notified = new Set()

function render() {
  const { status, snapshot, connected } = state.readings
  const d = derive()
  const updatedAt = snapshot?.updated_at ? new Date(snapshot.updated_at) : null

  topbar.update({ view: state.view, updatedAt, now: state.now, connected, triggered: d.triggeredIds.length, theme: state.theme })
  renderNotices(d)

  // Views. The monitor stays hidden while there is nothing to show but a notice.
  if (state.view !== lastView) {
    els.view.classList.remove('view-in')
    void els.view.offsetWidth
    els.view.classList.add('view-in')
    lastView = state.view
  }
  const onAlerts = state.view === 'alerts'
  const onEnergy = state.view === 'energy'
  els.alerts.hidden = !onAlerts
  els.energy.hidden = !onEnergy
  els.monitor.hidden = onAlerts || onEnergy || status === 'error' || d.firstPassPending

  if (onAlerts) alerts.update(d.data, state.rules)
  else if (!els.monitor.hidden) renderMonitor(d)
  // Always called so the energy view can stop its clock and polling when hidden.
  energy.update({ active: onEnergy, data: d.data, airStatus: status, city: state.m, site: state.site, mode: state.mode, scenario: state.scenario })

  notifyNewlyTriggered(d)
  palette.refresh()
}

function renderMonitor(d) {
  const { data, rows, counts, current } = d
  els.monitorSub.textContent = `Live Plume Labs readings${data ? ` for ${data.length} municipalities` : ''}, with each one’s 24-hour forecast.`
  strip.update(data, state.rules)

  levelFilter.update(
    [
      { value: 'all', label: 'All', count: data?.length },
      ...LEVELS.filter((l) => counts.has(l.key) || levelRank(l.key) <= 3).map((l) => ({ value: l.key, label: l.label, count: data ? (counts.get(l.key) ?? 0) : undefined })),
    ],
    state.level,
  )

  const listNode = rows && rows.length === 0 ? noRowsAtLevel : data && data.length === 0 ? noMunicipalities : table.el
  if (els.listSlot.firstChild !== listNode) els.listSlot.replaceChildren(listNode)
  if (listNode === table.el) table.update(rows, current?.city ?? '', state.sort)
  detail.update(current)
}

/** Error, first-pass and stale-data messages above the views. Rebuilt only when they change. */
function renderNotices(d) {
  const { status, snapshot, error, refreshing } = state.readings
  const stale = status === 'ready' && d.data && (snapshot?.error || error)
  // Simulation-only energy mode needs no air-quality data, so its notices stay out of the way.
  const quiet = state.view === 'energy' && state.mode !== 'live'
  const key = JSON.stringify([quiet, status === 'error' && error, d.firstPassPending && refreshing, d.firstPassPending, stale && (error ?? 'pass')])
  if (key === noticeKey) return
  noticeKey = key

  const nodes = []
  if (quiet) return els.notices.replaceChildren()
  if (status === 'error') {
    nodes.push(
      notice({
        tone: 'error',
        title: 'Readings are unavailable',
        body: [`${error} Start the scraper with `, h('code', {}, 'go run . -serve :8080'), ' in the webscraper folder.'],
        action: button({ label: 'Try again', onClick: refresh }),
      }),
    )
  }
  if (d.firstPassPending) {
    nodes.push(
      notice({
        title: 'Collecting the first readings',
        body: 'The scraper is scanning every Philippine city page for Laguna. The first pass takes about 30 seconds.',
        action: button({ label: 'Check again', loading: refreshing, onClick: refresh }),
      }),
    )
  }
  if (stale) nodes.push(h('p', { class: 'stale', role: 'status' }, `Some readings may be out of date. ${error ?? 'The last scrape pass had failures.'}`))
  els.notices.replaceChildren(...nodes)
}

/** A browser notification when a rule newly triggers (only if permission was granted). */
function notifyNewlyTriggered({ triggeredIds, data }) {
  const fresh = triggeredIds.filter((id) => !notified.has(id))
  notified.clear()
  triggeredIds.forEach((id) => notified.add(id))
  if (!fresh.length || !('Notification' in window) || Notification.permission !== 'granted') return
  for (const id of fresh) {
    const r = state.rules.find((x) => x.id === id)
    const m = data?.find((x) => x.city === r?.city)
    if (r && m) new Notification(`${r.city} reached ${fmtIndex(m.plume_index)}`, { body: `Your alert threshold is ${r.threshold}. ${m.advice}`, tag: id })
  }
}

/* ---------- Global wiring ---------- */

// Ctrl/Cmd+K anywhere, or "/" when not typing, opens search.
window.addEventListener('keydown', (e) => {
  const t = e.target
  const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault()
    palette.toggle()
  }
})

window.addEventListener('popstate', () => set(readUrl()))
followSystem(() => set({ theme: getTheme() }))
// Keep relative times ("Updated 3 minutes ago") current.
window.setInterval(() => set({ now: new Date() }), 30_000)

render()
readingsStream.start()
solar.start()
