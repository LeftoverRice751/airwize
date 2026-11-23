import type { ReactNode } from 'react'

export interface FilterPillProps {
  selected: boolean
  onSelect: () => void
  children: ReactNode
  /** Optional tally shown after the label; a zero count disables the pill. */
  count?: number
  disabled?: boolean
}

/** A toggle in a filter row. State is carried by aria-pressed, styled from it. */
export function FilterPill({ selected, onSelect, children, count, disabled }: FilterPillProps) {
  return (
    <button type="button" className="pill" aria-pressed={selected} onClick={onSelect} disabled={disabled ?? count === 0}>
      {children}
      {count !== undefined && <span className="pill__count num">{count}</span>}
    </button>
  )
}

/** Groups pills under one accessible label. */
export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pill-group" role="group" aria-label={label}>
      {children}
    </div>
  )
}
