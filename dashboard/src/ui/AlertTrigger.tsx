import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button } from './Button'
import { FilterGroup, FilterPill } from './FilterPill'
import { ALERT_PRESETS } from '../lib/levels'
import type { AlertRule } from '../lib/types'

export interface AlertTriggerProps {
  /** Fixed municipality; when omitted, a select offers `options`. */
  city?: string
  options?: string[]
  /** Rule being edited, if any. */
  initial?: AlertRule
  onSubmit: (rule: AlertRule) => void
  onCancel?: () => void
}

/**
 * Creates or edits one threshold rule: "alert when the index reaches N".
 * The same component serves the detail panel (fixed city) and the alerts view (choose a city).
 */
export function AlertTrigger({ city, options = [], initial, onSubmit, onCancel }: AlertTriggerProps) {
  const id = useId()
  const [target, setTarget] = useState(initial?.city ?? city ?? options[0] ?? '')
  const [threshold, setThreshold] = useState(String(initial?.threshold ?? 50))
  const [message, setMessage] = useState('')
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setTarget(initial?.city ?? city ?? options[0] ?? '')
    setThreshold(String(initial?.threshold ?? 50))
    setMessage('')
    setInvalid(false)
    // options identity changes on every poll; only reset when the subject changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, initial?.id])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(threshold)
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      setInvalid(true)
      setMessage('Enter an index between 1 and 500.')
      document.getElementById(`${id}-threshold`)?.focus()
      return
    }
    setInvalid(false)
    onSubmit({ id: initial?.id ?? crypto.randomUUID(), city: target, threshold: Math.round(n) })
    setMessage(initial ? `Updated the alert for ${target}.` : `Saved. You will be alerted when ${target} reaches ${Math.round(n)}.`)
  }

  return (
    <form className="trigger" onSubmit={submit} noValidate>
      {!city && (
        <div className="field">
          <label htmlFor={`${id}-city`}>Municipality</label>
          <select id={`${id}-city`} name="city" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-threshold`}>Alert when the index reaches</label>
        <input
          id={`${id}-threshold`}
          name="threshold"
          className="input input--num num"
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          value={threshold}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-help`}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </div>
      <FilterGroup label="Threshold presets">
        {ALERT_PRESETS.map((l) => (
          <FilterPill key={l.key} selected={Number(threshold) === l.min} onSelect={() => setThreshold(String(l.min))}>
            {l.label} <span className="num">{l.min}</span>
          </FilterPill>
        ))}
      </FilterGroup>
      <div className="trigger__actions">
        <Button variant="primary" type="submit" disabled={!target}>
          {initial ? 'Update alert' : 'Save alert'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <p className="help" id={`${id}-help`} aria-live="polite">
        {message}
      </p>
    </form>
  )
}
