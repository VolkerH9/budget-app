import Dexie, { type EntityTable } from 'dexie'
import type { Interval } from './lib/recurring'

export type EntryType = 'expense' | 'saving' | 'income'

export interface Category {
  id: string
  type: EntryType
  name: string
  emoji: string
  color: string
  order: number
  /** Monthly budget in cents, expense categories only */
  budget?: number
}

export interface Entry {
  id: string
  type: EntryType
  /** Always positive, in cents */
  amount: number
  categoryId: string
  date: string
  note?: string
  merchant?: string
  /** Small receipt photo as data URL */
  thumbnail?: string
  recurringId?: string
  /** `${recurringId}:${date}`, unique, so a booking cannot exist twice */
  recurringKey?: string
  createdAt: number
  sample?: boolean
}

export interface Recurring {
  id: string
  name: string
  amount: number
  type: EntryType
  categoryId: string
  interval: Interval
  bookingDay: number
  startDate: string
  endDate?: string
  paused: boolean
  /** Next date that has not been booked yet */
  nextDue: string
  sample?: boolean
}

export interface Meta {
  key: string
  value: unknown
}

export const db = new Dexie('budget') as Dexie & {
  categories: EntityTable<Category, 'id'>
  entries: EntityTable<Entry, 'id'>
  recurring: EntityTable<Recurring, 'id'>
  meta: EntityTable<Meta, 'key'>
}

db.version(1).stores({
  categories: 'id, type, order',
  entries: 'id, date, [type+date], categoryId, recurringId, &recurringKey',
  recurring: 'id, categoryId',
  meta: 'key',
})

const seed = (type: EntryType, prefix: string, rows: [string, string, string, string][]): Category[] =>
  rows.map(([id, name, emoji, color], order) => ({ id: `${prefix}-${id}`, type, name, emoji, color, order }))

export const DEFAULT_CATEGORIES: Category[] = [
  ...seed('expense', 'exp', [
    ['supermarkt', 'Supermarkt', '🛒', '#2a78d6'],
    ['food', 'Food & Restaurants', '🍽️', '#eb6834'],
    ['drogerie', 'Drogerie', '🧴', '#e87ba4'],
    ['shopping', 'Shopping & Kleidung', '🛍️', '#6250d6'],
    ['sport', 'Sport', '🏃', '#1baf7a'],
    ['freizeit', 'Kino & Freizeit', '🎬', '#eda100'],
    ['vacation', 'Vacation', '✈️', '#008300'],
    ['mobility', 'Mobility/Auto', '🚗', '#5b6b82'],
    ['studium', 'Studium', '🎓', '#a4703a'],
    ['abos', 'Abos', '📺', '#e34948'],
    ['diverse', 'Diverse', '📦', '#8e8e93'],
  ]),
  ...seed('saving', 'sav', [['investitionen', 'Investitionen', '📈', '#6250d6']]),
  ...seed('income', 'inc', [
    ['income', 'Income (Gehalt)', '💼', '#008300'],
    ['parents', 'Parents Allowance', '👪', '#1baf7a'],
    ['oma', 'Taschengeld Oma & Opa', '👵', '#eda100'],
  ]),
]

db.on('populate', (tx) => {
  tx.table('categories').bulkAdd(DEFAULT_CATEGORIES)
})

export const newId = () => crypto.randomUUID()

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export const setMeta = (key: string, value: unknown) => db.meta.put({ key, value })

export const removeMeta = (key: string) => db.meta.delete(key)

/** Asks iOS to keep the data even when the device runs low on storage. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
