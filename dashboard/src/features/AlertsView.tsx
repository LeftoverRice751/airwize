import { useEffect, useState } from 'react'
import type { AlertRule, Municipality } from '../lib/types'
import { evaluate, type AlertStatus } from '../lib/alerts'
import { fmtDayTime, fmtIndex, fromUnix } from '../lib/format'
import { AlertTrigger } from '../ui/AlertTrigger'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { cx } from '../lib/cx'

function statusText(s: AlertStatus): string {
  switch (s.kind) {
    case 'triggered':
      return `Triggered, index ${fmtIndex(s.value)} now`
    case 'forecast':
      return `Forecast to reach ${fmtIndex(s.value)} at ${fmtDayTime(fromUnix(s.at))}`
    case 'clear':
      return `Clear, 24-hour high ${fmtIndex(s.peak)}`
    case 'no-data':
      return 'No reading for this municipality'
  }
}

export interface AlertsViewProps {
  data: Municipality[] | null
  rules: AlertRule[]
  onSave: (r: AlertRule) => void
  onRemove: (id: string) => void
  onRestore: (r: AlertRule) => void
}

export function AlertsView({ data, rules, onSave, onRemove, onRestore }: AlertsViewProps) {
  const [editing, setEditing] = useState<AlertRule | undefined>()
  const [removed, setRemoved] = useState<AlertRule | null>(null)
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => ('Notification' in window ? Notification.permission : 'unsupported'))

  useEffect(() => {
    if (!removed) return
    const id = window.setTimeout(() => setRemoved(null), 8000)
    return () => window.clearTimeout(id)
  }, [removed])

  const byCity = new Map((data ?? []).map((m) => [m.city, m]))
  const cities = (data ?? []).map((m) => m.city).sort()
  const order = { triggered: 0, forecast: 1, clear: 2, 'no-data': 3 } as const
  const rows = rules
    .map((r) => ({ r, s: evaluate(r, byCity.get(r.city)) }))
    .sort((a, b) => order[a.s.kind] - order[b.s.kind] || a.r.city.localeCompare(b.r.city))

  return (
    <div className="alerts">
      <div className="view-head">
        <h1>Alerts</h1>
        <p className="muted">Each rule checks the live index and the next 24 hours of forecast. Rules are saved in this browser.</p>
      </div>

      <div className="alerts__grid">
        <section className="panel" aria-labelledby="rule-form-title">
          <h2 id="rule-form-title">{editing ? `Edit alert for ${editing.city}` : 'New alert'}</h2>
          {cities.length ? (
            <AlertTrigger
              options={cities}
              initial={editing}
              onSubmit={(r) => {
                onSave(r)
                setEditing(undefined)
              }}
              onCancel={editing ? () => setEditing(undefined) : undefined}
            />
          ) : (
            <p className="muted">Municipalities appear here once the first reading arrives.</p>
          )}
          {perm !== 'unsupported' && perm !== 'granted' && (
            <div className="perm">
              <p className="muted">{perm === 'denied' ? 'Browser notifications are blocked for this site. Allow them in your browser settings to be notified.' : 'Get a browser notification when a rule is triggered.'}</p>
              {perm === 'default' && (
                <Button variant="secondary" size="sm" onClick={() => void Notification.requestPermission().then(setPerm)}>
                  Turn on notifications
                </Button>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="rules-title">
          <h2 id="rules-title" className="visually-hidden">Your rules</h2>
          <p className="undo" role="status">
            {removed && (
              <>
                Removed the alert for {removed.city}.{' '}
                <button type="button" className="link-btn" onClick={() => { onRestore(removed); setRemoved(null) }}>
                  Undo
                </button>
              </>
            )}
          </p>
          {rules.length === 0 ? (
            <Notice title="No alert rules yet">Choose a municipality and a threshold. The rule shows as triggered when the index reaches it, and as forecast when the next 24 hours will.</Notice>
          ) : (
            <ul className="rules">
              {rows.map(({ r, s }) => (
                <li key={r.id} className={cx('rule', `rule--${s.kind}`)}>
                  <div className="rule__main">
                    <p className="rule__title">
                      {r.city} at <span className="num">{r.threshold}</span>
                    </p>
                    <p className="rule__status">{statusText(s)}</p>
                  </div>
                  <div className="rule__actions">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Edit alert for ${r.city}`}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove alert for ${r.city}`}
                      onClick={() => {
                        onRemove(r.id)
                        setRemoved(r)
                        if (editing?.id === r.id) setEditing(undefined)
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
