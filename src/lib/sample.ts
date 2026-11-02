import { db, getMeta, newId, removeMeta, setMeta, type Entry, type EntryType } from '../db'
import { addMonths, monthOf, toIso, today } from './dates'
import { firstOnOrAfter } from './recurring'

const SAMPLE_BUDGETS: Record<string, number> = {
  'exp-supermarkt': 25000,
  'exp-food': 12000,
  'exp-shopping': 8000,
  'exp-freizeit': 6000,
  'exp-mobility': 7000,
}

const MONTH_FACTORS = [1, 1.2, 0.8, 1.1, 0.7, 1.3]

const ROWS: [string, EntryType, number, number, string, string?][] = [
  // category, type, day, cents, note, merchant
  ['inc-income', 'income', 1, 145000, 'Werkstudentenjob'],
  ['inc-parents', 'income', 1, 30000, 'Monatlicher Zuschuss'],
  ['sav-investitionen', 'saving', 2, 15000, 'ETF-Sparplan'],
  ['exp-abos', 'expense', 3, 1299, 'Streaming'],
  ['exp-mobility', 'expense', 3, 5800, 'Deutschlandticket'],
  ['exp-supermarkt', 'expense', 4, 4312, 'Wocheneinkauf', 'Edeka'],
  ['exp-food', 'expense', 6, 1850, 'Mittagessen', 'Mensa'],
  ['exp-drogerie', 'expense', 7, 1645, '', 'dm'],
  ['exp-supermarkt', 'expense', 11, 3875, 'Wocheneinkauf', 'Rewe'],
  ['exp-freizeit', 'expense', 13, 2400, 'Kino mit Freunden'],
  ['exp-food', 'expense', 15, 3290, 'Pizza', 'Da Mario'],
  ['exp-shopping', 'expense', 17, 5999, 'Sneaker'],
  ['exp-sport', 'expense', 19, 2990, 'Fitnessstudio'],
  ['exp-supermarkt', 'expense', 21, 5120, 'Wocheneinkauf', 'Aldi'],
  ['exp-studium', 'expense', 23, 2450, 'Fachbuch'],
  ['exp-food', 'expense', 25, 2180, 'Café', 'Balzac'],
  ['exp-supermarkt', 'expense', 27, 4730, 'Wocheneinkauf', 'Rewe'],
  ['exp-diverse', 'expense', 28, 1500, 'Geschenk'],
]

/** Adds six months of clearly marked example data. */
export async function loadSampleData(now = today()): Promise<void> {
  const current = monthOf(now)
  const entries: Entry[] = []
  for (let back = 5; back >= 0; back--) {
    const month = addMonths(current, -back)
    const [y, m] = month.split('-').map(Number)
    ROWS.forEach(([categoryId, type, day, amount, note, merchant], index) => {
      // Early in a month the example would look empty, so future days land on today
      const planned = toIso(y, m, day)
      const date = planned > now ? now : planned
      // Stable variation so the months differ
      const factor = type === 'expense' ? MONTH_FACTORS[back] * (0.8 + ((index * 7 + back * 13) % 9) / 16) : 1
      entries.push({
        id: newId(), type, categoryId, date, createdAt: Date.now() - back,
        amount: Math.round(amount * factor), note: note || undefined, merchant, sample: true,
      })
    })
  }
  const schedule = { interval: 'monthly' as const, bookingDay: 1, startDate: `${addMonths(current, 1)}-01` }
  await db.transaction('rw', db.entries, db.recurring, db.categories, db.meta, async () => {
    await db.entries.bulkAdd(entries)
    await db.recurring.add({
      ...schedule, id: newId(), name: 'Beispiel: Miete', amount: 42000, type: 'expense', categoryId: 'exp-diverse',
      paused: false, nextDue: firstOnOrAfter(schedule, schedule.startDate), sample: true,
    })
    const added: string[] = []
    for (const [id, budget] of Object.entries(SAMPLE_BUDGETS)) {
      const category = await db.categories.get(id)
      if (category && !category.budget) {
        await db.categories.update(id, { budget })
        added.push(id)
      }
    }
    await setMeta('sampleBudgets', added)
  })
}

export async function hasSampleData(): Promise<boolean> {
  return (await db.entries.filter((e) => !!e.sample).count()) > 0 || (await db.recurring.filter((r) => !!r.sample).count()) > 0
}

/** Removes exactly what `loadSampleData` added, own entries stay untouched. */
export async function removeSampleData(): Promise<void> {
  await db.transaction('rw', db.entries, db.recurring, db.categories, db.meta, async () => {
    await db.entries.filter((e) => !!e.sample).delete()
    await db.recurring.filter((r) => !!r.sample).delete()
    for (const id of await getMeta<string[]>('sampleBudgets', [])) {
      const category = await db.categories.get(id)
      if (category?.budget === SAMPLE_BUDGETS[id]) await db.categories.update(id, { budget: undefined })
    }
    await removeMeta('sampleBudgets')
  })
}
