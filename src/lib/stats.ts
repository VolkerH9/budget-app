import { PARENT_CATEGORIES, PARENTS_EXPENSE, PARENTS_REFUND, type Category, type Entry, type EntryType, type Group } from '../db'
import { addMonths, monthOf, monthRange } from './dates'

export interface MonthSummary {
  income: number
  expense: number
  saving: number
  /** Income minus expenses minus savings */
  rest: number
  /** Savings divided by income, null without income */
  savingsRate: number | null
}

export function summarize(entries: Entry[]): MonthSummary {
  const sum = { income: 0, expense: 0, saving: 0 }
  for (const e of entries) sum[e.type] += e.amount
  return {
    ...sum,
    rest: sum.income - sum.expense - sum.saving,
    savingsRate: sum.income > 0 ? sum.saving / sum.income : null,
  }
}

export interface CategoryShare {
  category: Category
  amount: number
  share: number
}

/** Expenses per category, largest first. */
export function expensesByCategory(entries: Entry[], categories: Category[]): CategoryShare[] {
  const totals = new Map<string, number>()
  let total = 0
  for (const e of entries) {
    if (e.type !== 'expense') continue
    totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount)
    total += e.amount
  }
  return categories
    .filter((c) => totals.has(c.id))
    .map((category) => {
      const amount = totals.get(category.id)!
      return { category, amount, share: amount / total }
    })
    .sort((a, b) => b.amount - a.amount)
}

export interface MonthRow extends MonthSummary {
  month: string
}

/** One row per month, oldest first, ending with `lastMonth`. */
export function monthlySeries(entries: Entry[], lastMonth: string, count: number): MonthRow[] {
  const groups = new Map<string, Entry[]>()
  for (const e of entries) {
    const month = monthOf(e.date)
    groups.set(month, [...(groups.get(month) ?? []), e])
  }
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(lastMonth, i - count + 1)
    return { month, ...summarize(groups.get(month) ?? []) }
  })
}

export type BudgetLevel = 'ok' | 'warn' | 'over'

export interface BudgetRow {
  category: Category
  budget: number
  spent: number
  rest: number
  ratio: number
  level: BudgetLevel
}

export function budgetLevel(spent: number, budget: number): BudgetLevel {
  if (spent > budget) return 'over'
  return spent >= budget * 0.8 ? 'warn' : 'ok'
}

export function budgetRows(entries: Entry[], categories: Category[]): BudgetRow[] {
  return categories
    .filter((c) => c.type === 'expense' && c.budget)
    .map((category) => {
      const budget = category.budget!
      const spent = entries
        .filter((e) => e.type === 'expense' && e.categoryId === category.id)
        .reduce((sum, e) => sum + e.amount, 0)
      return { category, budget, spent, rest: budget - spent, ratio: spent / budget, level: budgetLevel(spent, budget) }
    })
}

// ---- Overcategories, periods and comparisons ----

export interface Period {
  from: string
  to: string
}

export const monthPeriod = (month: string): Period => {
  const [from, to] = monthRange(month)
  return { from, to }
}

export const yearPeriod = (year: number): Period => ({ from: `${year}-01-01`, to: `${year}-12-31` })

export const inPeriod = (entries: Entry[], p: Period) => entries.filter((e) => e.date >= p.from && e.date <= p.to)

/** The switch "Eltern-Kosten ausblenden" takes both parents categories out of every sum. */
export const withoutParents = (entries: Entry[], hide: boolean) =>
  hide ? entries.filter((e) => !PARENT_CATEGORIES.includes(e.categoryId)) : entries

export function sumByCategory(entries: Entry[], type: EntryType = 'expense'): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of entries) if (e.type === type) totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount)
  return totals
}

export interface Segment {
  /** Group id, or the category id for a category without overcategory */
  key: string
  label: string
  color: string
  amount: number
  share: number
  group?: Group
  categories: Category[]
}

/** Expenses per overcategory. Categories without one form their own segment. Largest first. */
export function expenseSegments(entries: Entry[], categories: Category[], groups: Group[]): Segment[] {
  const totals = sumByCategory(entries)
  const total = [...totals.values()].reduce((a, b) => a + b, 0)
  const groupIds = new Set(groups.map((g) => g.id))
  const segments: Segment[] = []
  for (const group of groups.filter((g) => g.type === 'expense')) {
    const members = categories.filter((c) => c.groupId === group.id)
    const amount = members.reduce((sum, c) => sum + (totals.get(c.id) ?? 0), 0)
    if (amount > 0) segments.push({ key: group.id, label: group.name, color: group.color, amount, share: amount / total, group, categories: members })
  }
  for (const c of categories.filter((c) => c.type === 'expense' && !(c.groupId && groupIds.has(c.groupId)))) {
    const amount = totals.get(c.id) ?? 0
    if (amount > 0) segments.push({ key: c.id, label: c.name, color: c.color, amount, share: amount / total, categories: [c] })
  }
  return segments.sort((a, b) => b.amount - a.amount)
}

/** Relative change, null when there is nothing to compare with. */
export const change = (current: number, previous: number): number | null =>
  previous === 0 ? null : (current - previous) / previous

export interface ParentsBalance {
  spent: number
  refunded: number
  /** What the parents still owe: their expenses minus their repayments */
  open: number
  entries: Entry[]
}

export function parentsBalance(entries: Entry[]): ParentsBalance {
  const own = entries.filter((e) => e.categoryId === PARENTS_EXPENSE && e.type === 'expense')
  const spent = own.reduce((sum, e) => sum + e.amount, 0)
  const refunded = entries.filter((e) => e.categoryId === PARENTS_REFUND && e.type === 'income').reduce((sum, e) => sum + e.amount, 0)
  return { spent, refunded, open: spent - refunded, entries: own.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt) }
}

export interface CompareNode {
  key: string
  label: string
  category?: Category
  color: string
  a: number
  b: number
  children: CompareNode[]
}

/** Overcategory → category tree with the sums of two periods, for the comparison lists. */
export function compareTree(type: EntryType, a: Entry[], b: Entry[], categories: Category[], groups: Group[]): CompareNode[] {
  const sumA = sumByCategory(a, type)
  const sumB = sumByCategory(b, type)
  const leaf = (c: Category): CompareNode => ({ key: c.id, label: c.name, category: c, color: c.color, a: sumA.get(c.id) ?? 0, b: sumB.get(c.id) ?? 0, children: [] })
  const used = (n: CompareNode) => n.a > 0 || n.b > 0
  const byAmount = (x: CompareNode, y: CompareNode) => y.a - x.a || y.b - x.b
  const groupIds = new Set(groups.map((g) => g.id))
  const nodes: CompareNode[] = []
  for (const g of groups.filter((g) => g.type === type)) {
    const children = categories.filter((c) => c.groupId === g.id).map(leaf).filter(used).sort(byAmount)
    if (children.length === 0) continue
    nodes.push({
      key: g.id, label: g.name, color: g.color, children,
      a: children.reduce((sum, n) => sum + n.a, 0), b: children.reduce((sum, n) => sum + n.b, 0),
    })
  }
  for (const c of categories.filter((c) => c.type === type && !(c.groupId && groupIds.has(c.groupId)))) {
    const node = leaf(c)
    if (used(node)) nodes.push(node)
  }
  return nodes.sort(byAmount)
}

export interface Highlight {
  label: string
  value: string
  detail?: string
}

/** Short findings for the year view, e.g. the most expensive month. */
export function yearHighlights(rows: MonthRow[], tree: CompareNode[], monthName: (month: string) => string, euro: (cents: number) => string): Highlight[] {
  const result: Highlight[] = []
  const active = rows.filter((r) => r.expense > 0 || r.income > 0)
  if (active.length > 0) {
    const top = active.reduce((x, y) => (y.expense > x.expense ? y : x))
    const low = active.reduce((x, y) => (y.expense < x.expense ? y : x))
    result.push({ label: 'Teuerster Monat', value: monthName(top.month), detail: euro(top.expense) })
    if (low.month !== top.month) result.push({ label: 'Günstigster Monat', value: monthName(low.month), detail: euro(low.expense) })
    const rated = active.filter((r) => r.savingsRate !== null)
    if (rated.length > 0) {
      const best = rated.reduce((x, y) => (y.savingsRate! > x.savingsRate! ? y : x))
      result.push({ label: 'Beste Sparquote', value: monthName(best.month), detail: `${Math.round(best.savingsRate! * 100)} %` })
    }
  }
  const compared = tree.filter((n) => n.b > 0)
  if (compared.length > 0) {
    const up = compared.reduce((x, y) => (y.a - y.b > x.a - x.b ? y : x))
    const down = compared.reduce((x, y) => (y.a - y.b < x.a - x.b ? y : x))
    if (up.a > up.b) result.push({ label: 'Größter Anstieg', value: up.label, detail: `+${euro(up.a - up.b)}` })
    if (down.a < down.b) result.push({ label: 'Größter Rückgang', value: down.label, detail: `−${euro(down.b - down.a)}` })
  }
  return result
}
