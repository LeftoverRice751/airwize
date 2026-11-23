import type { ReactNode } from 'react'

/** A figure and its label. Rendered inside a <dl> by the caller. */
export function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
      {detail && <dd className="stat__detail">{detail}</dd>}
    </div>
  )
}
