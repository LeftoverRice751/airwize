import type { SVGProps } from 'react'

const paths = {
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  external: 'M14 5h5v5M19 5l-8 8M18 14v5H5V6h5',
  sort: 'M8 9l4-4 4 4M8 15l4 4 4-4',
} as const

export type IconName = keyof typeof paths

/** Stroke icons drawn in currentColor; decorative unless given a title by the caller. */
export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={paths[name]} />
    </svg>
  )
}
