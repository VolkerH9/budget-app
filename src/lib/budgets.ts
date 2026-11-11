import type { Category, Entry, Goal, Group, Label, PeriodBudget } from '../db'
import { addDays, formatDate, monthRange } from './dates'
import { budgetLevel, type BudgetLevel } from './stats'

export interface Window {
  from: string
  to: string
}

/** Days from `from` to `to`, both included; 0 when `to` lies before `from` */
export function daysIn(from: string, to: string): number {
  if (to < from) return 0
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1
}

export function quarterOf(date: string): Window {
  const year = date.slice(0, 4)
  const first = Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3 + 1
  const last = `${year}-${String(first + 2).padStart(2, '0')}`
  return { from: `${year}-${String(first).padStart(2, '0')}-01`, to: monthRange(last)[1] }
}

export const yearOf = (date: string): Window => ({ from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` })

/** The current window of a period budget: this quarter, this year, or its fixed dates */
export function periodWindow(budget: PeriodBudget, now: string): Window {
  if (budget.period === 'quarter') return quarterOf(now)
  if (budget.period === 'year') return yearOf(now)
  return { from: budget.from ?? now, to: budget.to ?? now }
}

export const periodName = (budget: PeriodBudget, now: string) => {
  if (budget.period === 'quarter') return `pro Quartal · Q${Math.floor((Number(now.slice(5, 7)) - 1) / 3) + 1} ${now.slice(0, 4)}`
  if (budget.period === 'year') return `pro Jahr · ${now.slice(0, 4)}`
  return `${formatDate(budget.from ?? now)} – ${formatDate(budget.to ?? now)}`
}

/** Shortest number of days into a period before a forecast says anything */
export const MIN_DAYS = 5

/**
 * Where the spending heads, from the pace so far: the day the budget runs out,
 * or how much will be left. Null before day 5, outside the window, or when already over.
 */
export function spendForecast(spent: number, budget: number, window: Window, now: string, euro: (cents: number) => string): string | null {
  if (now < window.from || now > window.to) return null
  const elapsed = daysIn(window.from, now)
  if (elapsed < MIN_DAYS || spent > budget) return null
  const pace = spent / elapsed
  const remaining = daysIn(addDays(now, 1), window.to)
  const projected = spent + pace * remaining
  if (pace > 0 && projected > budget) {
    const day = addDays(now, Math.ceil((budget - spent) / pace))
    return `Bei diesem Tempo überschreitest du das Budget am ${formatDate(day).slice(0, 6)}`
  }
  return `Voraussichtlich ${euro(Math.round(budget - projected))} unter Budget`
}

export interface Progress {
  spent: number
  budget: number
  ratio: number
  rest: number
  level: BudgetLevel
  forecast: string | null
  window: Window | null
}

export function progress(spent: number, budget: number, window: Window | null, now: string, euro: (cents: number) => string): Progress {
  return {
    spent, budget, ratio: budget > 0 ? spent / budget : 0, rest: budget - spent, level: budgetLevel(spent, budget), window,
    forecast: window ? spendForecast(spent, budget, window, now, euro) : null,
  }
}

const expenseSum = (entries: Entry[], ids: Set<string>, window: Window | null) => entries
  .filter((e) => e.type === 'expense' && ids.has(e.categoryId) && (!window || (e.date >= window.from && e.date <= window.to)))
  .reduce((sum, e) => sum + e.amount, 0)

export const groupCategoryIds = (group: Group, categories: Category[]) => new Set(categories.filter((c) => c.groupId === group.id).map((c) => c.id))

/** Monthly budget of a category or an overcategory, in the given month */
export function monthProgress(entries: Entry[], ids: Set<string>, budget: number, month: string, now: string, euro: (cents: number) => string): Progress {
  const [from, to] = monthRange(month)
  const window = { from, to }
  return progress(expenseSum(entries, ids, window), budget, window, now, euro)
}

export function periodProgress(entries: Entry[], budget: PeriodBudget, categories: Category[], groups: Group[], now: string, euro: (cents: number) => string): Progress {
  const window = periodWindow(budget, now)
  const group = groups.find((g) => g.id === budget.targetId)
  const ids = budget.scope === 'group' && group ? groupCategoryIds(group, categories) : new Set([budget.targetId])
  return progress(expenseSum(entries, ids, window), budget.amount, window, now, euro)
}

/** A label budget counts all expenses with the label; the forecast uses the label's period */
export function labelProgress(entries: Entry[], label: Label, now: string, euro: (cents: number) => string): Progress {
  const spent = entries.filter((e) => e.type === 'expense' && e.labels?.includes(label.id)).reduce((sum, e) => sum + e.amount, 0)
  const window = label.from && label.to ? { from: label.from, to: label.to } : null
  return progress(spent, label.budget ?? 0, window, now, euro)
}

export interface GoalProgress {
  saved: number
  missing: number
  ratio: number
  reached: boolean
  overdue: boolean
  /** On the straight line from start to target date, or ahead of it */
  onTrack: boolean
  /** Needed per month from now on to reach the goal in time; null when reached or overdue */
  monthlyRate: number | null
  daysLeft: number
  forecast: string | null
  level: BudgetLevel
}

/** Savings since the goal's start in the chosen saving categories, plus what was saved before */
export function goalProgress(entries: Entry[], goal: Goal, now: string): GoalProgress {
  const ids = goal.categoryIds?.length ? new Set(goal.categoryIds) : null
  const since = entries
    .filter((e) => e.type === 'saving' && (!ids || ids.has(e.categoryId)) && e.date >= goal.start && e.date <= now)
    .reduce((sum, e) => sum + e.amount, 0)
  const initial = goal.initial ?? 0
  const saved = initial + since
  const missing = Math.max(0, goal.target - saved)
  const reached = missing === 0
  const overdue = !reached && now > goal.due
  const daysLeft = daysIn(now, goal.due)
  const total = daysIn(goal.start, goal.due)
  const elapsed = Math.min(total, daysIn(goal.start, now))
  const expected = initial + ((goal.target - initial) * elapsed) / Math.max(1, total)
  const onTrack = reached || (!overdue && saved >= Math.floor(expected))
  const monthlyRate = reached || overdue ? null : Math.ceil(missing / Math.max(1, daysLeft / 30.44))

  let forecast: string | null = null
  if (reached) forecast = 'Ziel erreicht'
  else if (elapsed >= MIN_DAYS && since > 0) {
    const day = addDays(now, Math.ceil(missing / (since / elapsed)))
    const late = daysIn(addDays(goal.due, 1), day)
    forecast = `Bei deiner aktuellen Rate erreichst du das Ziel am ${formatDate(day)}${late > 0 ? `, ${late} ${late === 1 ? 'Tag' : 'Tage'} nach dem Zieldatum` : ''}`
  } else if (elapsed >= MIN_DAYS) forecast = 'Seit dem Start gab es noch keine passende Sparbuchung.'

  return {
    saved, missing, ratio: goal.target > 0 ? saved / goal.target : 0, reached, overdue, onTrack, monthlyRate, daysLeft, forecast,
    level: overdue ? 'over' : onTrack ? 'ok' : 'warn',
  }
}

export interface Item {
  key: string
  kind: 'category' | 'group' | 'period' | 'label' | 'goal'
  name: string
  progress?: Progress
  goal?: GoalProgress
}

/** Order for the overview: overspent first, then goals behind plan, then the fullest budgets */
export function rank<T extends Item>(items: T[]): T[] {
  const score = (i: T) => {
    if (i.goal) return i.goal.level === 'over' ? 3 : i.goal.level === 'warn' ? 2.5 : 0.5
    const p = i.progress!
    return p.level === 'over' ? 3 + p.ratio : p.level === 'warn' ? 2 + p.ratio : p.ratio
  }
  return [...items].sort((a, b) => score(b) - score(a))
}
