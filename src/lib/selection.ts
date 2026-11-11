import type { Category, Entry, EntryType } from '../db'

/** Filter of the entry list; every part is optional */
export interface EntryFilter {
  type: EntryType | 'all'
  query: string
  categoryIds: string[]
  labelIds: string[]
  from: string
  to: string
  /** In cents */
  min: number | null
  max: number | null
}

export const EMPTY_FILTER: EntryFilter = { type: 'all', query: '', categoryIds: [], labelIds: [], from: '', to: '', min: null, max: null }

/** Number of filters in the filter sheet that are set, for the chip */
export const activeFilters = (f: EntryFilter) =>
  (f.categoryIds.length > 0 ? 1 : 0) + (f.labelIds.length > 0 ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.min !== null || f.max !== null ? 1 : 0)

export function filterEntries(entries: Entry[], f: EntryFilter): Entry[] {
  const needle = f.query.trim().toLowerCase()
  return entries
    .filter((e) => f.type === 'all' || e.type === f.type)
    .filter((e) => f.categoryIds.length === 0 || f.categoryIds.includes(e.categoryId))
    .filter((e) => f.labelIds.length === 0 || f.labelIds.some((id) => e.labels?.includes(id)))
    .filter((e) => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to))
    .filter((e) => (f.min === null || e.amount >= f.min) && (f.max === null || e.amount <= f.max))
    .filter((e) => !needle || `${e.note ?? ''} ${e.merchant ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export interface Part {
  category: Category | undefined
  categoryId: string
  amount: number
  share: number
  count: number
}

export interface SelectionSummary {
  count: number
  /** Expenses and savings, what was spent or put aside */
  total: number
  income: number
  average: number
  first: string | null
  last: string | null
  parts: Part[]
  incomeParts: Part[]
}

function partsOf(list: Entry[], categories: Category[]): Part[] {
  const total = list.reduce((s, e) => s + e.amount, 0)
  const sums = new Map<string, { amount: number; count: number }>()
  for (const e of list) {
    const p = sums.get(e.categoryId) ?? { amount: 0, count: 0 }
    sums.set(e.categoryId, { amount: p.amount + e.amount, count: p.count + 1 })
  }
  return [...sums].map(([categoryId, p]) => ({ categoryId, category: categories.find((c) => c.id === categoryId), amount: p.amount, count: p.count, share: total > 0 ? p.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

/** Sums of the chosen entries: spending and income apart, average, date span and split by category */
export function summarizeSelection(selected: Entry[], categories: Category[]): SelectionSummary {
  const spending = selected.filter((e) => e.type !== 'income')
  const incomes = selected.filter((e) => e.type === 'income')
  const total = spending.reduce((s, e) => s + e.amount, 0)
  const income = incomes.reduce((s, e) => s + e.amount, 0)
  const dates = selected.map((e) => e.date).sort()
  return {
    count: selected.length, total, income,
    average: selected.length > 0 ? Math.round((total + income) / selected.length) : 0,
    first: dates[0] ?? null, last: dates.at(-1) ?? null,
    parts: partsOf(spending, categories), incomeParts: partsOf(incomes, categories),
  }
}
