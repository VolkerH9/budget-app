import { addDays, addMonths, daysInMonth, toIso, weekday } from './dates'

export type Interval = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

export interface Schedule {
  interval: Interval
  /** weekly: 1 (Monday) … 7 (Sunday). Otherwise day of month 1 … 31. */
  bookingDay: number
  startDate: string
  endDate?: string
  /** Interval 'custom': months between bookings */
  everyMonths?: number
}

const MONTH_STEP: Record<Exclude<Interval, 'weekly' | 'custom'>, number> = { monthly: 1, quarterly: 3, yearly: 12 }

export const monthStep = (s: Pick<Schedule, 'interval' | 'everyMonths'>) =>
  s.interval === 'custom' ? Math.max(1, s.everyMonths ?? 1) : MONTH_STEP[s.interval as keyof typeof MONTH_STEP]

/** Day 31 falls on the last day of shorter months. */
function dateInMonth(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number)
  return toIso(y, m, Math.min(day, daysInMonth(y, m)))
}

/** First booking date of a schedule that is on or after `from`. */
export function firstOnOrAfter(s: Schedule, from: string): string {
  const floor = from > s.startDate ? from : s.startDate
  if (s.interval === 'weekly') {
    const offset = (s.bookingDay - weekday(s.startDate) + 7) % 7
    let date = addDays(s.startDate, offset)
    while (date < floor) date = addDays(date, 7)
    return date
  }
  const step = monthStep(s)
  let month = s.startDate.slice(0, 7)
  let date = dateInMonth(month, s.bookingDay)
  while (date < floor) {
    month = addMonths(month, step)
    date = dateInMonth(month, s.bookingDay)
  }
  return date
}

/** The booking date that follows `date`. */
export function nextAfter(s: Schedule, date: string): string {
  if (s.interval === 'weekly') return addDays(date, 7)
  return dateInMonth(addMonths(date.slice(0, 7), monthStep(s)), s.bookingDay)
}

/** All dates from `nextDue` up to and including `until` that are due for booking. */
export function dueDates(s: Schedule, nextDue: string, until: string): string[] {
  const dates: string[] = []
  let date = nextDue
  while (date <= until && (!s.endDate || date <= s.endDate)) {
    dates.push(date)
    date = nextAfter(s, date)
  }
  return dates
}
