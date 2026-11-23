import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  /** Shows the busy state and blocks repeat presses. */
  loading?: boolean
  icon?: ReactNode
  /** For variant="icon", children become the visually hidden accessible label. */
  children?: ReactNode
}

/**
 * The single button primitive. One `primary` per view; `secondary` is outlined,
 * `ghost` is typographic, `icon` is a square hit target with a hidden label.
 */
export function Button({ variant = 'secondary', size = 'md', loading = false, icon, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn', `btn--${variant}`, size === 'sm' && 'btn--sm', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon}
      {variant === 'icon' ? <span className="visually-hidden">{children}</span> : children}
    </button>
  )
}
