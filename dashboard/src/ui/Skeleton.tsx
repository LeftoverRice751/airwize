import { cx } from '../lib/cx'

/** Placeholder block in the shape of the content that is loading. */
export function Skeleton({ w = '100%', h = '1em', className }: { w?: string; h?: string; className?: string }) {
  return <span className={cx('skeleton', className)} style={{ width: w, height: h }} aria-hidden="true" />
}
