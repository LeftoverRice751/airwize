import { levelLabel } from '../lib/levels'
import { cx } from '../lib/cx'

/** Severity label with a thin tinted bar. The word carries the meaning; the bar only echoes it. */
export function LevelBadge({ rank, size = 'md' }: { rank: number; size?: 'md' | 'lg' }) {
  return (
    <span className={cx('badge', `sev-${rank}`, size === 'lg' && 'badge--lg')}>
      <span className="badge__bar" aria-hidden="true" />
      {levelLabel(rank)}
    </span>
  )
}
