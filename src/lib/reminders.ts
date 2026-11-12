import { isParentsExpense, type Entry } from '../db'
import { addDays, addMonths, monthOf, today, weekday } from './dates'

export interface BackupState {
  /** The reminder is due and not dismissed */
  reminder: boolean
  /** Stands for the current reminder; dismissing stores it */
  key: string
  /** No backup yet, or the last one is 30 days or more old */
  stale: boolean
  /** Days since the last backup, null for none */
  days: number | null
}

export interface BackupSettings {
  enabled: boolean
  /** Every week on `weekday`, or every month on `day` */
  interval: 'weekly' | 'monthly'
  /** 1 = Monday … 7 = Sunday */
  weekday: number
  /** Day of the month, 1 to 28 */
  day: number
  dismissed: string | null
}

/**
 * The reminder comes every week on the chosen weekday (or every month on the chosen day),
 * until a backup was made on that day or later, or the reminder was dismissed.
 */
export function backupState(now: string, last: number | null, settings: BackupSettings, clock = Date.now()): BackupState {
  const due = settings.interval === 'weekly'
    ? addDays(now, -((weekday(now) - settings.weekday + 7) % 7))
    : `${monthOf(now)}-${String(Math.min(28, Math.max(1, settings.day))).padStart(2, '0')}`
  const lastDay = last === null ? null : today(new Date(last))
  const days = last === null ? null : Math.floor((clock - last) / 86_400_000)
  return {
    reminder: settings.enabled && now >= due && (lastDay === null || lastDay < due) && settings.dismissed !== due,
    key: due,
    stale: days === null || days >= 30,
    days,
  }
}

/** The month a parents report is due for: the current one on its last day, otherwise the one before. */
export function reportMonth(now: string): string {
  return monthOf(addDays(now, 1)) !== monthOf(now) ? monthOf(now) : addMonths(monthOf(now), -1)
}

/** Month whose parents report should be made, null when there is none or it is done. */
export function parentsReportDue(now: string, entries: Entry[], done: string[], enabled: boolean): string | null {
  if (!enabled) return null
  const month = reportMonth(now)
  if (done.includes(month)) return null
  return entries.some((e) => isParentsExpense(e) && monthOf(e.date) === month) ? month : null
}
