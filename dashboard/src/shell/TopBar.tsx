import { useState } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { cx } from '../lib/cx'
import { relativeMinutes } from '../lib/format'

export type View = 'monitor' | 'alerts'

const LINKS: { view: View; label: string }[] = [
  { view: 'monitor', label: 'Monitor' },
  { view: 'alerts', label: 'Alerts' },
]

export interface TopBarProps {
  view: View
  onNavigate: (v: View) => void
  updatedAt: Date | null
  now: Date
  refreshing: boolean
  onRefresh: () => void
  /** Number of rules currently triggered, shown beside the Alerts link. */
  triggered: number
}

/** App shell header. Under 40rem the links and status collapse behind a menu button. */
export function TopBar({ view, onNavigate, updatedAt, now, refreshing, onRefresh, triggered }: TopBarProps) {
  const [open, setOpen] = useState(false)
  const go = (v: View) => {
    onNavigate(v)
    setOpen(false)
  }

  return (
    <header className="topbar">
      <div className="topbar__inner container">
        <a className="wordmark" href="./" aria-label="Laguna air, home">
          Laguna air
        </a>
        <Button variant="icon" className="topbar__menu" icon={<Icon name={open ? 'close' : 'menu'} />} aria-expanded={open} aria-controls="topbar-panel" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close menu' : 'Open menu'}
        </Button>
        <div id="topbar-panel" className={cx('topbar__panel', open && 'is-open')}>
          <nav aria-label="Main">
            <ul className="nav">
              {LINKS.map((l) => (
                <li key={l.view}>
                  <a
                    href={`?view=${l.view}`}
                    className="nav__link"
                    aria-current={view === l.view ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      go(l.view)
                    }}
                  >
                    {l.label}
                    {l.view === 'alerts' && triggered > 0 && (
                      <span className="nav__count num" aria-label={`${triggered} triggered`}>
                        {triggered}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="topbar__status">
            <span className="topbar__updated" aria-live="polite">
              {updatedAt ? `Updated ${relativeMinutes(updatedAt, now)}` : 'Waiting for first reading'}
            </span>
            <Button variant="ghost" size="sm" icon={<Icon name="refresh" size={16} className={cx(refreshing && 'spin')} />} loading={refreshing} onClick={onRefresh}>
              Refresh
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
