import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

/** Inline message for empty and error states, with at most one action. */
export function Notice({ tone = 'neutral', title, children, action }: { tone?: 'neutral' | 'error'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('notice', tone === 'error' && 'notice--error')} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="notice__title">{title}</p>
      {children && <p className="notice__body">{children}</p>}
      {action && <div className="notice__action">{action}</div>}
    </div>
  )
}
