const TZ = 'Asia/Manila'

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const dayTimeFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const weekdayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', timeZone: TZ })
const hourFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', hour12: false, timeZone: TZ })

export const fmtTime = (d: Date) => timeFmt.format(d)
export const fmtDayTime = (d: Date) => dayTimeFmt.format(d)
export const fmtWeekday = (d: Date) => weekdayFmt.format(d)
export const fromUnix = (s: number) => new Date(s * 1000)
export const localHour = (d: Date) => Number(hourFmt.format(d)) % 24

export const fmtIndex = (n: number) => Math.round(n).toString()
export const fmtConc = (n: number | undefined) => (n === undefined ? 'n/a' : n.toFixed(1))

const POLLUTANT_NAMES: Record<string, string> = { PM25: 'PM2.5', PM10: 'PM10', NO2: 'NO₂', O3: 'O₃' }
export const POLLUTANT_ORDER = ['PM25', 'PM10', 'NO2', 'O3'] as const
export const pollutantName = (k: string) => POLLUTANT_NAMES[k] ?? k

export function relativeMinutes(from: Date, now: Date): string {
  const m = Math.round((now.getTime() - from.getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m === 1) return '1 minute ago'
  if (m < 60) return `${m} minutes ago`
  const h = Math.round(m / 60)
  return h === 1 ? '1 hour ago' : `${h} hours ago`
}
