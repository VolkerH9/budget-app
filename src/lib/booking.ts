import { db, newId, type Entry, type Recurring } from '../db'
import { today } from './dates'
import { dueDates, firstOnOrAfter, nextAfter } from './recurring'

export const recurringKey = (recurringId: string, date: string) => `${recurringId}:${date}`

function entryFor(r: Recurring, date: string): Entry {
  return {
    id: newId(),
    type: r.type,
    amount: r.amount,
    categoryId: r.categoryId,
    date,
    note: r.name,
    recurringId: r.id,
    recurringKey: recurringKey(r.id, date),
    createdAt: Date.now(),
    sample: r.sample,
  }
}

/**
 * Books everything that became due since the last run. `nextDue` moves in the same
 * transaction as the new entries: an entry deleted later does not come back, and an
 * interrupted run books nothing twice. Returns the number of new entries.
 */
export async function bookDueEntries(now = today()): Promise<number> {
  return db.transaction('rw', db.recurring, db.entries, async () => {
    let booked = 0
    for (const r of await db.recurring.toArray()) {
      // Abos without an amount yet are drafts
      if (r.paused || !(r.amount > 0)) continue
      const dates = dueDates(r, r.nextDue, now)
      if (dates.length === 0) continue
      const keys = dates.map((date) => recurringKey(r.id, date))
      const existing = await db.entries.where('recurringKey').anyOf(keys).primaryKeys()
      const known = new Set(
        (await db.entries.bulkGet(existing)).map((entry) => entry?.recurringKey),
      )
      const fresh = dates.filter((date) => !known.has(recurringKey(r.id, date)))
      await db.entries.bulkAdd(fresh.map((date) => entryFor(r, date)))
      await db.recurring.update(r.id, { nextDue: nextAfter(r, dates[dates.length - 1]) })
      booked += fresh.length
    }
    return booked
  })
}

/** Number of entries a new or changed standing order would book right away. */
export function countBacklog(r: Pick<Recurring, 'interval' | 'everyMonths' | 'bookingDay' | 'startDate' | 'endDate'>, now = today()): number {
  return dueDates(r, firstOnOrAfter(r, r.startDate), now).length
}

/**
 * Resuming does not book the paused period: the standing order continues
 * with the first booking date from today on.
 */
export const resumeNextDue = (r: Recurring, now = today()) => firstOnOrAfter(r, now)
