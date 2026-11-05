import type { Recurring } from '../db'
import { addDays, formatDate, today } from './dates'
import { monthStep } from './recurring'

export const isDraft = (r: Recurring) => !(r.amount > 0)
export const isActive = (r: Recurring) => !r.paused && !isDraft(r) && !(r.endDate && r.nextDue > r.endDate)

/** Cost per month, a yearly Abo counts with a twelfth. In cents, not rounded. */
export function monthlyCost(r: Recurring): number {
  if (r.interval === 'weekly') return (r.amount * 52) / 12
  return r.amount / monthStep(r)
}

export function totals(subscriptions: Recurring[]): { month: number; year: number } {
  const month = subscriptions.filter(isActive).reduce((sum, r) => sum + monthlyCost(r), 0)
  return { month: Math.round(month), year: Math.round(month * 12) }
}

export const intervalLabel = (r: Pick<Recurring, 'interval' | 'everyMonths'>) => {
  if (r.interval === 'monthly') return 'monatlich'
  if (r.interval === 'yearly') return 'jährlich'
  if (r.interval === 'quarterly') return 'alle 3 Monate'
  if (r.interval === 'weekly') return 'wöchentlich'
  return r.everyMonths === 1 ? 'monatlich' : `alle ${r.everyMonths} Monate`
}

/** Last day to cancel before the next renewal */
export const noticeDeadline = (r: Recurring) =>
  r.subscription?.noticeDays ? addDays(r.nextDue, -r.subscription.noticeDays) : null

export interface Reminder {
  key: string
  subscription: Recurring
  kind: 'renewal' | 'notice'
  date: string
  text: string
}

/** Abos that renew, or whose notice period ends, within the next `leadDays` days. */
export function reminders(subscriptions: Recurring[], leadDays: number, now = today()): Reminder[] {
  const until = addDays(now, leadDays)
  const result: Reminder[] = []
  for (const r of subscriptions.filter(isActive)) {
    const deadline = noticeDeadline(r)
    if (deadline && deadline >= now && deadline <= until) {
      result.push({ key: `${r.id}:notice:${deadline}`, subscription: r, kind: 'notice', date: deadline, text: `${r.name}: kündigen bis ${formatDate(deadline)}` })
    }
    if (r.nextDue >= now && r.nextDue <= until) {
      result.push({ key: `${r.id}:renewal:${r.nextDue}`, subscription: r, kind: 'renewal', date: r.nextDue, text: `${r.name} verlängert sich am ${formatDate(r.nextDue)}` })
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

const icsText = (value: string) => value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
const icsDate = (iso: string) => iso.replace(/-/g, '')

function rule(r: Recurring): string {
  if (r.interval === 'weekly') return 'FREQ=WEEKLY'
  if (r.interval === 'yearly') return 'FREQ=YEARLY'
  const step = monthStep(r)
  // Day 29 to 31 falls on the last day of shorter months, as in the app
  const day = r.bookingDay > 28 ? `;BYMONTHDAY=${Array.from({ length: r.bookingDay - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1` : ''
  return `FREQ=MONTHLY;INTERVAL=${step}${day}`
}

/**
 * Calendar file with the renewal and, if set, the end of the notice period.
 * The alarm rings at 9:00, `leadDays` days before.
 */
export function subscriptionIcs(r: Recurring, leadDays: number, stamp = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const trigger = leadDays > 0 ? `-P${leadDays - 1}DT15H` : 'PT9H'
  const event = (uid: string, date: string, summary: string, repeat: string) => [
    'BEGIN:VEVENT',
    `UID:${uid}@budget-app`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${icsDate(date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(date, 1))}`,
    `SUMMARY:${icsText(summary)}`,
    ...(r.subscription?.note ? [`DESCRIPTION:${icsText(r.subscription.note)}`] : []),
    `RRULE:${repeat}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(summary)}`,
    `TRIGGER:${trigger}`,
    'END:VALARM',
    'END:VEVENT',
  ]
  const deadline = noticeDeadline(r)
  // The notice deadline moves with the renewal, so it repeats with the same rule from its own date
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Budget//Abos//DE',
    'CALSCALE:GREGORIAN',
    ...event(`${r.id}-renewal`, r.nextDue, `Abo ${r.name} verlängert sich`, rule(r)),
    ...(deadline ? event(`${r.id}-notice`, deadline, `Abo ${r.name}: letzter Tag zum Kündigen`, rule({ ...r, bookingDay: Number(deadline.slice(8, 10)) })) : []),
    'END:VCALENDAR',
  ]
  return `${lines.join('\r\n')}\r\n`
}
