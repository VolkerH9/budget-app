import { isParentsEntry, isParentsExpense, isParentsRefund, type Category, type Entry, type Goal, type Group, type Label, type PeriodBudget, type Recurring } from '../db'
import { goalProgress, groupCategoryIds, labelProgress, monthProgress, periodProgress, type GoalProgress, type Progress } from './budgets'
import { addMonths, monthLabel, monthOf, monthRange } from './dates'
import { change, expenseSegments, monthlySeries, summarize, type MonthRow, type MonthSummary, type Segment } from './stats'

export type StatementKind = 'month' | 'year'

/** A month 'YYYY-MM' or a year 'YYYY' */
export interface StatementPeriod {
  kind: StatementKind
  key: string
}

export const periodRange = (p: StatementPeriod): [string, string] => (p.kind === 'month' ? monthRange(p.key) : [`${p.key}-01-01`, `${p.key}-12-31`])

export const previousPeriod = (p: StatementPeriod): StatementPeriod =>
  p.kind === 'month' ? { kind: 'month', key: addMonths(p.key, -1) } : { kind: 'year', key: String(Number(p.key) - 1) }

export const periodTitle = (p: StatementPeriod) => (p.kind === 'month' ? monthLabel(p.key) : `Jahr ${p.key}`)

/** "Budget_2026-10_Oktober" or "Budget_2026_Jahresabrechnung" */
export const fileBase = (p: StatementPeriod) => (p.kind === 'month' ? `Budget_${p.key}_${monthLabel(p.key).split(' ')[0]}` : `Budget_${p.key}_Jahresabrechnung`)

/** The last finished month and year, whose statements appear by themselves */
export function finishedPeriods(now: string): StatementPeriod[] {
  const month = addMonths(monthOf(now), -1)
  const list: StatementPeriod[] = [{ kind: 'month', key: month }]
  if (now.slice(5, 7) === '01') list.push({ kind: 'year', key: String(Number(now.slice(0, 4)) - 1) })
  return list
}

export interface Comparison {
  current: number
  previous: number
  diff: number
  /** null without a previous value */
  ratio: number | null
}

const compare = (current: number, previous: number): Comparison => ({ current, previous, diff: current - previous, ratio: change(current, previous) })

export interface CategoryLine {
  category: Category
  amount: number
  share: number
  count: number
  previous: number
}

export interface GroupLine extends Segment {
  count: number
  previous: number
  lines: CategoryLine[]
}

export interface BudgetLine {
  key: string
  name: string
  kind: 'category' | 'group' | 'period' | 'label'
  progress: Progress
  /** Year statements: months in which a monthly budget held */
  kept?: { months: number; of: number }
}

export interface GoalLine {
  goal: Goal
  progress: GoalProgress
}

export interface LabelLine {
  label: Label
  amount: number
  count: number
}

export interface RecurringLine {
  recurring: Recurring
  count: number
  amount: number
}

export interface Statement {
  period: StatementPeriod
  from: string
  to: string
  summary: MonthSummary
  previous: MonthSummary
  comparison: { income: Comparison; expense: Comparison; saving: Comparison; rest: Comparison; savingsRate: Comparison }
  groups: GroupLine[]
  budgets: BudgetLine[]
  goals: GoalLine[]
  labels: LabelLine[]
  top: Entry[]
  subscriptions: RecurringLine[]
  standing: RecurringLine[]
  parents: { spent: number; refunded: number; openAtEnd: number; count: number }
  /** Year statements only */
  months?: MonthRow[]
  averageExpense?: number
  dearest?: MonthRow
  cheapest?: MonthRow
  entries: Entry[]
}

export interface StatementInput {
  entries: Entry[]
  categories: Category[]
  groups: Group[]
  labels: Label[]
  recurring: Recurring[]
  budgets: PeriodBudget[]
  goals: Goal[]
  now: string
  euro: (cents: number) => string
  /** Only entries with one of these labels, when set */
  labelFilter?: string[]
  /** The switch "Eltern-Kosten ausblenden": parents entries stay out of the sums */
  hideParents?: boolean
}

const within = (entries: Entry[], from: string, to: string) => entries.filter((e) => e.date >= from && e.date <= to)

function categoryLines(current: Entry[], previous: Entry[], categories: Category[], total: number): CategoryLine[] {
  const lines: CategoryLine[] = []
  for (const category of categories.filter((c) => c.type === 'expense')) {
    const own = current.filter((e) => e.type === 'expense' && e.categoryId === category.id)
    const before = previous.filter((e) => e.type === 'expense' && e.categoryId === category.id).reduce((s, e) => s + e.amount, 0)
    if (own.length === 0 && before === 0) continue
    const amount = own.reduce((s, e) => s + e.amount, 0)
    lines.push({ category, amount, share: total > 0 ? amount / total : 0, count: own.length, previous: before })
  }
  return lines.sort((a, b) => b.amount - a.amount)
}

/** Everything about one month or year, ready for the screen, the PDF and Excel. */
export function buildStatement(period: StatementPeriod, input: StatementInput): Statement {
  const { categories, groups, labels, recurring, budgets, goals, now, euro } = input
  const visible = input.hideParents ? input.entries.filter((e) => !isParentsEntry(e)) : input.entries
  const filtered = input.labelFilter?.length ? visible.filter((e) => input.labelFilter!.some((id) => e.labels?.includes(id))) : visible
  const [from, to] = periodRange(period)
  const prev = previousPeriod(period)
  const [pFrom, pTo] = periodRange(prev)
  const current = within(filtered, from, to)
  const previous = within(filtered, pFrom, pTo)
  const summary = summarize(current)
  const before = summarize(previous)
  const total = summary.expense

  const lines = categoryLines(current, previous, categories, total)
  const segments = expenseSegments(current, categories, groups)
  const groupLines: GroupLine[] = segments.map((s) => ({
    ...s,
    count: current.filter((e) => e.type === 'expense' && s.categories.some((c) => c.id === e.categoryId)).length,
    previous: previous.filter((e) => e.type === 'expense' && s.categories.some((c) => c.id === e.categoryId)).reduce((sum, e) => sum + e.amount, 0),
    lines: lines.filter((l) => s.categories.some((c) => c.id === l.category.id) && l.amount > 0),
  }))

  // Budgets as they stood at the end of the period, or today while it runs
  const end = to < now ? to : now
  const budgetLines: BudgetLine[] = []
  const months = period.kind === 'month' ? [period.key] : Array.from({ length: 12 }, (_, i) => `${period.key}-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= monthOf(now))
  const monthly = (key: string, name: string, kind: 'category' | 'group', ids: Set<string>, amount: number) => {
    if (period.kind === 'month') {
      budgetLines.push({ key, name, kind, progress: monthProgress(input.entries, ids, amount, period.key, end, euro) })
      return
    }
    const results = months.map((m) => monthProgress(input.entries, ids, amount, m, end, euro))
    const spent = results.reduce((s, r) => s + r.spent, 0)
    const yearly = amount * months.length
    budgetLines.push({
      key, name, kind,
      progress: { spent, budget: yearly, ratio: yearly > 0 ? spent / yearly : 0, rest: yearly - spent, level: spent > yearly ? 'over' : spent >= yearly * 0.8 ? 'warn' : 'ok', forecast: null, window: null },
      kept: { months: results.filter((r) => r.spent <= r.budget).length, of: results.length },
    })
  }
  for (const g of groups.filter((x) => x.type === 'expense' && x.budget)) monthly(`group:${g.id}`, g.name, 'group', groupCategoryIds(g, categories), g.budget!)
  for (const c of categories.filter((x) => x.type === 'expense' && x.budget)) monthly(`category:${c.id}`, c.name, 'category', new Set([c.id]), c.budget!)
  for (const b of budgets) {
    // A period budget belongs to the statement when its window overlaps the period
    const target = b.scope === 'group' ? groups.find((g) => g.id === b.targetId) : categories.find((c) => c.id === b.targetId)
    if (!target) continue
    const p = periodProgress(input.entries, b, categories, groups, end, euro)
    if (p.window && p.window.to >= from && p.window.from <= to) budgetLines.push({ key: `period:${b.id}`, name: target.name, kind: 'period', progress: p })
  }
  for (const l of labels.filter((x) => x.budget && current.some((e) => e.labels?.includes(x.id)))) {
    budgetLines.push({ key: `label:${l.id}`, name: l.name, kind: 'label', progress: labelProgress(input.entries, l, end, euro) })
  }

  const goalLines = goals.filter((g) => !g.archived && g.start <= to).map((goal) => ({ goal, progress: goalProgress(input.entries, goal, end) }))

  const labelLines: LabelLine[] = labels
    .map((label) => {
      const own = current.filter((e) => e.type === 'expense' && e.labels?.includes(label.id))
      return { label, amount: own.reduce((s, e) => s + e.amount, 0), count: own.length }
    })
    .filter((l) => l.count > 0)
    .sort((a, b) => b.amount - a.amount)

  const recurringLines = (list: Recurring[]) => list
    .map((r) => {
      const own = current.filter((e) => e.recurringId === r.id)
      return { recurring: r, count: own.length, amount: own.reduce((s, e) => s + e.amount, 0) }
    })
    .filter((l) => l.count > 0)
    .sort((a, b) => b.amount - a.amount)

  const parentsCurrent = current.filter(isParentsExpense)
  const upToEnd = input.entries.filter((e) => e.date <= to)
  const result: Statement = {
    period, from, to, summary, previous: before,
    comparison: {
      income: compare(summary.income, before.income), expense: compare(summary.expense, before.expense), saving: compare(summary.saving, before.saving),
      rest: compare(summary.rest, before.rest), savingsRate: compare(summary.savingsRate ?? 0, before.savingsRate ?? 0),
    },
    groups: groupLines,
    budgets: budgetLines,
    goals: goalLines,
    labels: labelLines,
    top: current.filter((e) => e.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 10),
    subscriptions: recurringLines(recurring.filter((r) => r.subscription)),
    standing: recurringLines(recurring.filter((r) => !r.subscription)),
    parents: {
      spent: parentsCurrent.reduce((s, e) => s + e.amount, 0),
      refunded: current.filter(isParentsRefund).reduce((s, e) => s + e.amount, 0),
      openAtEnd: upToEnd.filter(isParentsExpense).reduce((s, e) => s + e.amount, 0) - upToEnd.filter(isParentsRefund).reduce((s, e) => s + e.amount, 0),
      count: parentsCurrent.length,
    },
    entries: current.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt),
  }
  if (period.kind === 'year') {
    const rows = monthlySeries(current, `${period.key}-12`, 12)
    const active = rows.filter((r) => r.expense > 0 || r.income > 0)
    result.months = rows
    result.averageExpense = active.length > 0 ? Math.round(active.reduce((s, r) => s + r.expense, 0) / active.length) : 0
    if (active.length > 0) {
      result.dearest = active.reduce((x, y) => (y.expense > x.expense ? y : x))
      result.cheapest = active.reduce((x, y) => (y.expense < x.expense ? y : x))
    }
  }
  return result
}
