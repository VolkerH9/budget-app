import { PARENTS_EXPENSE, type Category, type Entry, type Group, type Label } from '../db'
import { addDays } from './dates'
import { expenseSegments, sumByCategory, type Segment } from './stats'

/** A label with a period is set by itself on new entries of a date inside it, until it ends. */
export const isActiveOn = (label: Label, date: string) =>
  !label.archived && (!!label.from || !!label.to) && (label.from ?? '') <= date && date <= (label.to ?? '9999-12-31')

/** Labels to preselect for a new entry on `date` */
export const autoLabels = (labels: Label[], date: string) => labels.filter((l) => isActiveOn(l, date)).map((l) => l.id)

/**
 * The labels of a new entry: the automatic ones of its date, minus those the user
 * took off for this entry, plus those added by hand.
 */
export function chosenLabels(auto: string[], added: string[], removed: string[]): string[] {
  return [...new Set([...auto.filter((id) => !removed.includes(id)), ...added])]
}

/** Days until the label ends, today included; null without an end */
export function daysLeft(label: Label, now: string): number | null {
  if (!label.to) return null
  let days = 0
  for (let d = now; d <= label.to && days < 1000; d = addDays(d, 1)) days++
  return days
}

const daysBetween = (from: string, to: string) => {
  let days = 0
  for (let d = from; d <= to && days < 5000; d = addDays(d, 1)) days++
  return days
}

export interface CategoryPart {
  category: Category
  amount: number
  share: number
  count: number
}

export interface LabelSummary {
  /** Expenses with the label */
  total: number
  /** Income with the label, e.g. money back from friends */
  income: number
  count: number
  /** Expenses per day over the label's period, or from its first to its last entry */
  perDay: number | null
  days: number
  byCategory: CategoryPart[]
  byGroup: Segment[]
  entries: Entry[]
}

export function labelSummary(all: Entry[], label: Label, categories: Category[], groups: Group[], now: string): LabelSummary {
  const entries = all.filter((e) => e.labels?.includes(label.id)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  const expenses = entries.filter((e) => e.type === 'expense')
  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  const income = entries.filter((e) => e.type === 'income').reduce((sum, e) => sum + e.amount, 0)
  const dates = expenses.map((e) => e.date).sort()
  const from = label.from ?? dates[0]
  const end = label.to ?? dates.at(-1)
  // A running period counts up to today
  const to = end && end > now && (label.from ?? '') <= now ? now : end
  const days = from && to && from <= to ? daysBetween(from, to) : 0
  const sums = sumByCategory(expenses)
  const counts = new Map<string, number>()
  for (const e of expenses) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1)
  const byCategory = categories
    .filter((c) => sums.has(c.id))
    .map((category) => ({ category, amount: sums.get(category.id)!, share: sums.get(category.id)! / total, count: counts.get(category.id)! }))
    .sort((a, b) => b.amount - a.amount)
  return {
    total, income, count: entries.length, days,
    perDay: days > 0 && total > 0 ? Math.round(total / days) : null,
    byCategory,
    byGroup: expenseSegments(expenses, categories, groups),
    entries,
  }
}

export type BulkAction =
  | { kind: 'parents'; on: boolean }
  | { kind: 'category'; category: Category }
  | { kind: 'addLabel'; labelId: string }
  | { kind: 'removeLabel'; labelId: string }

const withLabels = (e: Entry, labels: string[]): Entry => ({ ...e, labels: labels.length > 0 ? labels : undefined })

/** The entries a bulk action changes, already changed. Entries it does not apply to are left out. */
export function applyBulk(entries: Entry[], action: BulkAction): Entry[] {
  const result: Entry[] = []
  for (const e of entries) {
    if (action.kind === 'parents') {
      if (e.type !== 'expense' || !!e.forParents === action.on || (action.on && e.categoryId === PARENTS_EXPENSE)) continue
      result.push({ ...e, forParents: action.on || undefined })
    } else if (action.kind === 'category') {
      if (e.type !== action.category.type || e.categoryId === action.category.id) continue
      result.push({ ...e, categoryId: action.category.id })
    } else if (action.kind === 'addLabel') {
      if (e.labels?.includes(action.labelId)) continue
      result.push(withLabels(e, [...(e.labels ?? []), action.labelId]))
    } else {
      if (!e.labels?.includes(action.labelId)) continue
      result.push(withLabels(e, e.labels.filter((id) => id !== action.labelId)))
    }
  }
  return result
}
