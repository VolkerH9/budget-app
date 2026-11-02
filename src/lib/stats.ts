import type { Category, Entry } from '../db'
import { addMonths, monthOf } from './dates'

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
