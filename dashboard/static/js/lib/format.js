/** Number and date formatting. All times are shown in Manila time. */
const TZ = 'Asia/Manila'

const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const dayTimeFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
const weekdayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', timeZone: TZ })
const hourFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', hour12: false, timeZone: TZ })

export const fmtTime = (d) => timeFmt.format(d)
export const fmtDayTime = (d) => dayTimeFmt.format(d)
export const fmtWeekday = (d) => weekdayFmt.format(d)
export const fromUnix = (sec) => new Date(sec * 1000)
export const localHour = (d) => Number(hourFmt.format(d)) % 24

export const fmtIndex = (n) => Math.round(n).toString()
export const fmtConc = (n) => (n === undefined || n === null ? 'n/a' : n.toFixed(1))

/** Signed whole number with a true minus sign: +3, −2, 0. */
export const signed = (n) => {
  const r = Math.round(n)
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0'
}

const POLLUTANT_NAMES = { PM25: 'PM2.5', PM10: 'PM10', NO2: 'NO₂', O3: 'O₃' }
export const POLLUTANT_ORDER = ['PM25', 'PM10', 'NO2', 'O3']
export const pollutantName = (k) => POLLUTANT_NAMES[k] ?? k

export function relativeMinutes(from, now) {
  const m = Math.round((now.getTime() - from.getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m === 1) return '1 minute ago'
  if (m < 60) return `${m} minutes ago`
  const hrs = Math.round(m / 60)
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`
}
