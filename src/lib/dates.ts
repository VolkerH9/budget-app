// Dates are stored as local 'YYYY-MM-DD' strings and months as 'YYYY-MM',
// so a booking never shifts to another day through time zone conversion.

const pad = (n: number) => String(n).padStart(2, '0')

export const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function today(now = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export const monthOf = (iso: string) => iso.slice(0, 7)

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toIso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** ISO weekday: 1 = Monday … 7 = Sunday */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1
}

export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number)
  return [`${month}-01`, `${month}-${pad(daysInMonth(y, m))}`]
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export const monthShort = (month: string) => MONTHS_SHORT[Number(month.slice(5, 7)) - 1]

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** Section title in the entry list, e.g. "Heute" or "Mo., 03.11.2026" */
export function dayLabel(iso: string, now = today()): string {
  if (iso === now) return 'Heute'
  if (iso === addDays(now, -1)) return 'Gestern'
  return `${WEEKDAYS[weekday(iso) - 1].slice(0, 2)}., ${formatDate(iso)}`
}

export function isValidIso(iso: unknown): iso is string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}
