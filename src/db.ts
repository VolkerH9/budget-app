import Dexie, { type EntityTable } from 'dexie'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import type { Interval } from './lib/recurring'

export type EntryType = 'expense' | 'saving' | 'income'

export interface Group {
  id: string
  type: EntryType
  name: string
  color: string
  order: number
}

export interface Category {
  id: string
  type: EntryType
  name: string
  emoji: string
  /** Name of a line icon, see components/CategoryIcon */
  icon?: string
  /** Which of the two is shown, the icon when not set */
  symbol?: 'icon' | 'emoji'
  color: string
  order: number
  /** Monthly budget in cents, expense categories only */
  budget?: number
  groupId?: string
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
  /** Ids of the attached receipt photos, stored encrypted by lib/vault */
  photos?: string[]
  recurringId?: string
  /** `${recurringId}:${date}`, unique, so a booking cannot exist twice */
  recurringKey?: string
  /** Parents paid this expense back */
  refunded?: boolean
  /** Repayment from the parents: the month of the statement it pays first */
  forMonth?: string
  /** Expense in any category that the parents pay back, as if it were in "Eltern" */
  forParents?: boolean
  /** Ids of the labels on this entry */
  labels?: string[]
  createdAt: number
  sample?: boolean
}

export interface Subscription {
  /** Days before the renewal by which it must be cancelled */
  noticeDays?: number
  note?: string
}

export interface Recurring {
  id: string
  name: string
  amount: number
  type: EntryType
  categoryId: string
  interval: Interval
  /** Interval 'custom': number of months between bookings */
  everyMonths?: number
  bookingDay: number
  startDate: string
  endDate?: string
  paused: boolean
  /** Next date that has not been booked yet */
  nextDue: string
  /** Set for entries of the Abos list */
  subscription?: Subscription
  sample?: boolean
}

export type LabelKind = 'trip' | 'event' | 'project' | 'gift' | 'other'

/** A marker on entries in addition to their category, e.g. "🏔️ Skiurlaub Tirol 2026" */
export interface Label {
  id: string
  name: string
  color: string
  emoji: string
  /** Name of a line icon, see components/CategoryIcon */
  icon?: string
  symbol: 'icon' | 'emoji'
  kind?: LabelKind
  /** In cents, optional */
  budget?: number
  /** While a date lies in from–to, new entries of that date get the label */
  from?: string
  to?: string
  archived?: boolean
  createdAt: number
}

export interface Meta {
  key: string
  value: unknown
}

export type Tables = {
  categories: EntityTable<Category, 'id'>
  groups: EntityTable<Group, 'id'>
  entries: EntityTable<Entry, 'id'>
  recurring: EntityTable<Recurring, 'id'>
  meta: EntityTable<Meta, 'key'>
  labels: EntityTable<Label, 'id'>
}

export const TABLES = ['categories', 'groups', 'entries', 'recurring', 'meta', 'labels'] as const
export type TableName = (typeof TABLES)[number]

// The in-memory database schedules its work with setImmediate. Safari has none,
// and its setTimeout fallback waits at least 4 ms per step.
if (typeof (globalThis as { setImmediate?: unknown }).setImmediate !== 'function') {
  const queue: (() => void)[] = []
  const channel = new MessageChannel()
  channel.port1.onmessage = () => queue.shift()?.()
  Object.assign(globalThis, { setImmediate: (fn: () => void) => { queue.push(fn); channel.port2.postMessage(0) } })
}

/**
 * The app works on a copy in memory. Only lib/vault writes to the device,
 * and only in encrypted form.
 */
export const db = new Dexie('budget-memory', { indexedDB: new IDBFactory(), IDBKeyRange }) as Dexie & Tables

db.version(1).stores({
  categories: 'id, type, order, groupId',
  groups: 'id, type, order',
  entries: 'id, date, [type+date], categoryId, recurringId, &recurringKey',
  recurring: 'id, categoryId',
  meta: 'key',
})

db.version(2).stores({
  entries: 'id, date, [type+date], categoryId, recurringId, &recurringKey, *labels',
  labels: 'id',
})

/** Fixed ids of the two categories the parents switch looks at */
export const PARENTS_EXPENSE = 'exp-eltern'
export const PARENTS_REFUND = 'inc-rueckzahlung'
export const PARENT_CATEGORIES = [PARENTS_EXPENSE, PARENTS_REFUND]

/** An expense the parents pay back: in "Eltern", or marked for them in another category */
export const isParentsExpense = (e: Entry) => e.type === 'expense' && (e.categoryId === PARENTS_EXPENSE || !!e.forParents)
export const isParentsRefund = (e: Entry) => e.type === 'income' && e.categoryId === PARENTS_REFUND
export const isParentsEntry = (e: Entry) => isParentsExpense(e) || isParentsRefund(e)

/** Calm label colours, readable as chips in light and dark mode */
export const LABEL_COLORS = [
  '#4a76c8', '#2f86b5', '#1f9a9a', '#2f9a76', '#5a9a3c', '#8d9a2a', '#a8861a', '#c87a22',
  '#c86f30', '#cc5c50', '#cc5c70', '#b8558f', '#a066cc', '#7a6bd1', '#5d6fa8', '#8d7b68',
]

export const LABEL_KINDS: [LabelKind, string, string][] = [
  ['trip', 'Urlaub', 'plane'], ['event', 'Event', 'party-popper'], ['project', 'Projekt', 'wrench'],
  ['gift', 'Geschenke', 'gift'], ['other', 'Sonstiges', 'sparkles'],
]
export const SUBSCRIPTION_CATEGORY = 'exp-abos'

// Muted colours, checked for colour blindness and contrast in light and dark mode
export const PALETTE = ['#4a76c8', '#c86f30', '#2f9a76', '#a066cc', '#a8861a', '#cc5c70']
const [BLUE, ORANGE, GREEN, PURPLE, MUSTARD, ROSE] = PALETTE

export const DEFAULT_GROUPS: Group[] = [
  { id: 'grp-essen', type: 'expense', name: 'Essen & Alltag', color: BLUE, order: 0 },
  { id: 'grp-freizeit', type: 'expense', name: 'Freizeit & Lifestyle', color: ORANGE, order: 1 },
  { id: 'grp-studium', type: 'expense', name: 'Studium & Abos', color: GREEN, order: 2 },
  { id: 'grp-mobil', type: 'expense', name: 'Mobilität', color: PURPLE, order: 3 },
  { id: 'grp-familie', type: 'income', name: 'Familie', color: BLUE, order: 0 },
]

type Seed = [id: string, name: string, emoji: string, icon: string, color: string, groupId?: string]

const seed = (type: EntryType, prefix: string, rows: Seed[]): Category[] =>
  rows.map(([id, name, emoji, icon, color, groupId], order) => ({
    id: `${prefix}-${id}`, type, name, emoji, icon, color, order, ...(groupId ? { groupId } : {}),
  }))

export const DEFAULT_CATEGORIES: Category[] = [
  ...seed('expense', 'exp', [
    ['supermarkt', 'Supermarkt', '🛒', 'shopping-cart', BLUE, 'grp-essen'],
    ['food', 'Food', '🍔', 'hamburger', BLUE, 'grp-essen'],
    ['restaurants', 'Restaurants', '🍽️', 'utensils', BLUE, 'grp-essen'],
    ['drogerie', 'Drogerie', '🧴', 'spray-can', BLUE, 'grp-essen'],
    ['shopping', 'Shopping & Kleidung', '🛍️', 'shirt', ORANGE, 'grp-freizeit'],
    ['sport', 'Sport', '🏃', 'dumbbell', ORANGE, 'grp-freizeit'],
    ['freizeit', 'Freizeit', '🎬', 'clapperboard', ORANGE, 'grp-freizeit'],
    ['vacation', 'Vacation', '✈️', 'plane', ORANGE, 'grp-freizeit'],
    ['geschenke', 'Geschenke', '🎁', 'gift', ORANGE, 'grp-freizeit'],
    ['studium', 'Studium', '🎓', 'graduation-cap', GREEN, 'grp-studium'],
    ['abos', 'Abos', '📺', 'tv', GREEN, 'grp-studium'],
    ['mobility', 'Auto', '🚗', 'car-front', PURPLE, 'grp-mobil'],
    ['oepnv', 'ÖPNV', '🚆', 'train-front', PURPLE, 'grp-mobil'],
    ['parken', 'Parken', '🅿️', 'square-parking', PURPLE, 'grp-mobil'],
    ['strafzettel', 'Strafzettel & Bußgelder', '🚨', 'siren', PURPLE, 'grp-mobil'],
    ['eltern', 'Eltern', '👪', 'heart-handshake', MUSTARD],
    ['diverse', 'Diverse', '📦', 'package', ROSE],
  ]),
  ...seed('saving', 'sav', [['investitionen', 'Investitionen', '📈', 'trending-up', GREEN]]),
  ...seed('income', 'inc', [
    ['income', 'Income (Gehalt)', '💼', 'briefcase', PURPLE],
    ['parents', 'Parents Allowance', '👪', 'users', BLUE, 'grp-familie'],
    ['oma', 'Taschengeld Oma & Opa', '👵', 'hand-coins', BLUE, 'grp-familie'],
    ['rueckzahlung', 'Kostenrückzahlung Eltern', '💶', 'undo-2', BLUE, 'grp-familie'],
  ]),
]

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
