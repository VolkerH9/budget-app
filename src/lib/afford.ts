import type { Category, Entry, Goal, Group, Label, PeriodBudget, Recurring } from '../db'
import { daysIn, goalProgress, periodWindow, type Window } from './budgets'
import { addDays, addMonths, daysInMonth, monthOf, monthRange } from './dates'
import { firstOnOrAfter, dueDates } from './recurring'
import { isActive } from './subscriptions'
import { budgetLevel, type BudgetLevel } from './stats'

export interface AffordQuestion {
  /** In cents */
  amount: number
  categoryId: string
  labelId?: string
  /** Month of the purchase, 'YYYY-MM' */
  month: string
  /** Paid over this many months, 1 = at once */
  spread: number
}

export interface AffordData {
  entries: Entry[]
  categories: Category[]
  groups: Group[]
  labels: Label[]
  recurring: Recurring[]
  budgets: PeriodBudget[]
  goals: Goal[]
  /** Savings rate goal in percent from the settings, null without */
  savingsGoal: number | null
  /** Hourly wage in cents, null without */
  hourlyWage: number | null
  now: string
}

export interface Forecast {
  income: number
  expense: number
  saving: number
  rest: number
}

export interface BudgetImpact {
  key: string
  name: string
  kind: 'category' | 'group' | 'period' | 'label'
  budget: number
  before: number
  after: number
  levelBefore: BudgetLevel
  levelAfter: BudgetLevel
}

export interface GoalImpact {
  goal: Goal
  rateBefore: number | null
  rateAfter: number | null
  /** Days the goal moves back if the money is missing from savings; null without a saving pace */
  shiftDays: number | null
}

export type Light = 'green' | 'yellow' | 'red'

export interface AffordResult {
  light: Light
  reason: string
  /** Part paid per month */
  monthly: number
  forecast: Forecast
  restAfter: number
  budgets: BudgetImpact[]
  /** Share of income left for saving, before and after; null without income */
  savingsRate: { before: number | null; after: number | null; goal: number | null }
  goals: GoalImpact[]
  hours: number | null
}

const sum = (list: Entry[]) => list.reduce((s, e) => s + e.amount, 0)
const inRange = (list: Entry[], from: string, to: string) => list.filter((e) => e.date >= from && e.date <= to)

/**
 * Where a month ends up. The current month: what is booked so far, the standing orders
 * and Abos still due, and the other spending at the mean of its pace so far and the
 * usual pace (before day 5 the usual pace alone). A later month: the average of the
 * last three months.
 */
export function monthForecast(data: AffordData, month: string): Forecast {
  const current = monthOf(data.now)
  const [from, to] = monthRange(month)
  const past = [1, 2, 3].map((i) => addMonths(current, -i))
  const pastEntries = (type: Entry['type'], onlyVariable = false) => past.map((m) => {
    const [a, b] = monthRange(m)
    return sum(inRange(data.entries, a, b).filter((e) => e.type === type && (!onlyVariable || !e.recurringId)))
  })
  const average = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length)

  if (month > current) {
    const income = average(pastEntries('income'))
    const expense = average(pastEntries('expense'))
    const saving = average(pastEntries('saving'))
    return { income, expense, saving, rest: income - expense - saving }
  }
  const booked = inRange(data.entries, from, month === current ? data.now : to)
  const totals = { income: sum(booked.filter((e) => e.type === 'income')), expense: sum(booked.filter((e) => e.type === 'expense')), saving: sum(booked.filter((e) => e.type === 'saving')) }
  if (month === current) {
    // Standing orders and Abos that are still due this month
    for (const r of data.recurring.filter(isActive)) {
      const start = r.nextDue > data.now ? r.nextDue : firstOnOrAfter(r, addDays(data.now, 1))
      totals[r.type] += dueDates(r, start, to).length * r.amount
    }
    const [y, m] = month.split('-').map(Number)
    const day = Number(data.now.slice(8, 10))
    const remaining = daysInMonth(y, m) - day
    const variable = sum(booked.filter((e) => e.type === 'expense' && !e.recurringId))
    const usual = average(pastEntries('expense', true)) / 30.44
    // One large purchase early in the month should not double the forecast, so the pace
    // so far is evened out with the usual pace of the last three months
    const pace = day < 5 ? usual : usual > 0 ? (variable / day + usual) / 2 : variable / day
    totals.expense += Math.round(pace * remaining)
  }
  return { ...totals, rest: totals.income - totals.expense - totals.saving }
}

/** Checks a purchase against the month, the budgets and the goals. Changes nothing. */
export function checkPurchase(q: AffordQuestion, data: AffordData, euro: (cents: number) => string): AffordResult {
  const spread = Math.max(1, Math.round(q.spread))
  const monthly = Math.round(q.amount / spread)
  const months = Array.from({ length: spread }, (_, i) => addMonths(q.month, i))
  const forecast = monthForecast(data, q.month)
  const restAfter = forecast.rest - monthly
  const category = data.categories.find((c) => c.id === q.categoryId)
  const group = category?.groupId ? data.groups.find((g) => g.id === category.groupId) : undefined
  const reference = q.month === monthOf(data.now) ? data.now : `${q.month}-01`

  const impacts: BudgetImpact[] = []
  const add = (key: string, name: string, kind: BudgetImpact['kind'], budget: number, before: number, extra: number) => {
    impacts.push({ key, name, kind, budget, before, after: before + extra, levelBefore: budgetLevel(before, budget), levelAfter: budgetLevel(before + extra, budget) })
  }
  const [mFrom, mTo] = monthRange(q.month)
  const spentIn = (ids: Set<string>, w: Window) => sum(inRange(data.entries, w.from, w.to).filter((e) => e.type === 'expense' && ids.has(e.categoryId)))
  if (category?.type === 'expense') {
    if (category.budget) add(`category:${category.id}`, category.name, 'category', category.budget, spentIn(new Set([category.id]), { from: mFrom, to: mTo }), monthly)
    if (group?.budget) {
      const ids = new Set(data.categories.filter((c) => c.groupId === group.id).map((c) => c.id))
      add(`group:${group.id}`, group.name, 'group', group.budget, spentIn(ids, { from: mFrom, to: mTo }), monthly)
    }
    for (const b of data.budgets) {
      const fits = (b.scope === 'category' && b.targetId === category.id) || (b.scope === 'group' && b.targetId === group?.id)
      if (!fits) continue
      const w = periodWindow(b, reference)
      if (reference < w.from || reference > w.to) continue
      const ids = b.scope === 'group' ? new Set(data.categories.filter((c) => c.groupId === b.targetId).map((c) => c.id)) : new Set([b.targetId])
      const inside = months.filter((m) => `${m}-01` <= w.to && monthRange(m)[1] >= w.from).length
      add(`period:${b.id}`, (b.scope === 'group' ? group?.name : category.name) ?? category.name, 'period', b.amount, spentIn(ids, w), monthly * inside)
    }
  }
  const label = q.labelId ? data.labels.find((l) => l.id === q.labelId) : undefined
  if (label?.budget) add(`label:${label.id}`, label.name, 'label', label.budget, sum(data.entries.filter((e) => e.type === 'expense' && e.labels?.includes(label.id))), q.amount)

  const goalRate = data.savingsGoal === null ? null : data.savingsGoal / 100
  const rateOf = (rest: number) => (forecast.income > 0 ? Math.max(0, rest + forecast.saving) / forecast.income : null)
  const savingsRate = { before: rateOf(forecast.rest), after: rateOf(restAfter), goal: goalRate }

  const goals: GoalImpact[] = data.goals.filter((g) => !g.archived).flatMap((goal) => {
    const p = goalProgress(data.entries, goal, data.now)
    if (p.reached || p.overdue) return []
    const monthsLeft = Math.max(1, p.daysLeft / 30.44)
    const since = p.saved - (goal.initial ?? 0)
    const elapsed = daysIn(goal.start, data.now)
    const pace = elapsed >= 5 && since > 0 ? since / elapsed : null
    return [{ goal, rateBefore: p.monthlyRate, rateAfter: Math.ceil((p.missing + q.amount) / monthsLeft), shiftDays: pace ? Math.ceil(q.amount / pace) : null }]
  })

  // The first reason that applies decides the light
  const over = impacts.find((i) => i.levelAfter === 'over' && i.levelBefore !== 'over')
  const stillOver = impacts.find((i) => i.levelBefore === 'over')
  const tight = impacts.find((i) => i.levelAfter === 'warn' && i.levelBefore === 'ok')
  let light: Light = 'green'
  let reason = `Passt locker: Am Monatsende bleiben voraussichtlich ${euro(restAfter)} übrig.`
  if (restAfter < 0) {
    light = 'red'
    reason = `Dein Monat würde voraussichtlich mit ${euro(-restAfter)} im Minus enden.`
  } else if (over) {
    light = 'red'
    reason = `Das sprengt dein Budget „${over.name}“ um ${euro(over.after - over.budget)}.`
  } else if (stillOver) {
    light = 'red'
    reason = `Dein Budget „${stillOver.name}“ ist schon überschritten.`
  } else if (goalRate !== null && savingsRate.before !== null && savingsRate.after !== null && savingsRate.before >= goalRate && savingsRate.after < goalRate) {
    light = 'red'
    reason = `Damit fällt deine mögliche Sparquote unter dein Ziel von ${data.savingsGoal} %.`
  } else if (tight) {
    light = 'yellow'
    reason = `Passt, aber „${tight.name}“ wäre dann zu ${Math.round((tight.after / tight.budget) * 100)} % ausgeschöpft.`
  } else if (forecast.income > 0 && restAfter < forecast.income * 0.1) {
    light = 'yellow'
    reason = `Passt knapp: Am Monatsende blieben nur noch ${euro(restAfter)} übrig.`
  }

  return {
    light, reason, monthly, forecast, restAfter, budgets: impacts, savingsRate, goals,
    hours: data.hourlyWage ? Math.round((q.amount / data.hourlyWage) * 2) / 2 : null,
  }
}
