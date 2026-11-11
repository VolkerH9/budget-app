import { isParentsExpense, type Entry } from '../db'
import { addDays, addMonths, monthOf, today } from './dates'

export interface BackupState {
  /** The monthly reminder is due and not dismissed */
  reminder: boolean
  /** No backup yet, or the last one is 30 days or more old */
  stale: boolean
  /** Days since the last backup, null for none */
  days: number | null
}

/**
 * The reminder comes on `day` of every month, until a backup was made on that
 * day or later, or the reminder was dismissed for the month.
 */
export function backupState(now: string, last: number | null, settings: { enabled: boolean; day: number; dismissed: string | null }, clock = Date.now()): BackupState {
  const month = monthOf(now)
  const due = `${month}-${String(Math.min(28, Math.max(1, settings.day))).padStart(2, '0')}`
  const lastDay = last === null ? null : today(new Date(last))
  const days = last === null ? null : Math.floor((clock - last) / 86_400_000)
  return {
    reminder: settings.enabled && now >= due && (lastDay === null || lastDay < due) && settings.dismissed !== month,
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
