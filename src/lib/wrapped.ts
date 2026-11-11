import type { Category, Entry, Goal, Group, Label } from '../db'
import { goalProgress, groupCategoryIds, monthProgress } from './budgets'
import { addDays, formatDate, monthLabel, monthOf, weekday } from './dates'
import { periodRange, previousPeriod, type StatementPeriod } from './statement'
import { summarize } from './stats'

/** One card of the review. Every line has a version without amounts, for sharing with percentages only. */
export interface WrappedCard {
  key: string
  /** Two colours of the background gradient */
  colors: [string, string]
  eyebrow: string
  /** The big number, counted up on screen */
  cents?: number
  big?: string
  /** Replaces the big number when amounts are hidden */
  bigPrivate?: string
  title?: string
  /** Replaces the title when amounts are hidden; empty hides it */
  titlePrivate?: string
  /** `private` replaces the line when amounts are hidden; empty hides it */
  lines: { text: string; private?: string }[]
}

export interface WrappedData {
  entries: Entry[]
  categories: Category[]
  groups: Group[]
  labels: Label[]
  goals: Goal[]
  now: string
  euro: (cents: number) => string
}

/** Fewest expenses in a period before there is a review */
export const MIN_EXPENSES = 5

const COLORS: [string, string][] = [
  ['#3368c9', '#1f3f8a'], ['#c86f30', '#8a3f14'], ['#2f9a76', '#16604a'], ['#7a6bd1', '#45399a'],
  ['#cc5c70', '#8a2b40'], ['#2f86b5', '#17507a'], ['#a8861a', '#6b520a'], ['#b8558f', '#76285a'],
  ['#1f9a9a', '#0e5f5f'], ['#5d6fa8', '#323f70'], ['#3368c9', '#7a6bd1'],
]

const pct = (ratio: number) => `${Math.round(ratio * 100)} %`
const sum = (list: Entry[]) => list.reduce((s, e) => s + e.amount, 0)
const weekStart = (iso: string) => addDays(iso, 1 - weekday(iso))

/** Whether a period has enough entries for a review */
export function hasWrapped(entries: Entry[], period: StatementPeriod): boolean {
  const [from, to] = periodRange(period)
  return entries.filter((e) => e.type === 'expense' && e.date >= from && e.date <= to).length >= MIN_EXPENSES
}

/** The cards of a monthly or yearly review. Cards without enough data are left out. */
export function buildWrapped(period: StatementPeriod, data: WrappedData): WrappedCard[] {
  const { euro, categories } = data
  const yearly = period.kind === 'year'
  const name = yearly ? period.key : monthLabel(period.key).split(' ')[0]
  const prevName = yearly ? String(Number(period.key) - 1) : monthLabel(previousPeriod(period).key).split(' ')[0]
  const [from, to] = periodRange(period)
  const [pFrom, pTo] = periodRange(previousPeriod(period))
  const current = data.entries.filter((e) => e.date >= from && e.date <= to)
  const previous = data.entries.filter((e) => e.date >= pFrom && e.date <= pTo)
  const expenses = current.filter((e) => e.type === 'expense')
  if (expenses.length < MIN_EXPENSES) return []
  const s = summarize(current)
  const p = summarize(previous)
  const cards: WrappedCard[] = []
  const color = () => COLORS[cards.length % COLORS.length]
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Ohne Kategorie'

  // 1 Balance
  cards.push({
    key: 'balance', colors: color(), eyebrow: yearly ? `Dein Jahr ${name}` : `Dein ${name}`, cents: s.expense, bigPrivate: s.savingsRate === null ? '–' : pct(s.savingsRate),
    title: 'ausgegeben', titlePrivate: 'Sparquote',
    lines: [
      { text: `Eingenommen: ${euro(s.income)}`, private: s.income > 0 ? `Ausgaben: ${pct(s.expense / s.income)} der Einnahmen` : '' },
      { text: `Gespart: ${euro(s.saving)}`, private: '' },
      ...(s.savingsRate !== null ? [{ text: `Sparquote: ${pct(s.savingsRate)}`, private: '' }] : []),
    ],
  })

  // 2 Top category
  const byCategory = new Map<string, number>()
  for (const e of expenses) byCategory.set(e.categoryId, (byCategory.get(e.categoryId) ?? 0) + e.amount)
  const top = [...byCategory].sort((a, b) => b[1] - a[1])[0]
  if (top) {
    cards.push({
      key: 'top', colors: color(), eyebrow: 'Deine Top-Kategorie', big: catName(top[0]), bigPrivate: catName(top[0]), title: `${pct(top[1] / s.expense)} deiner Ausgaben`,
      lines: [{ text: `${euro(top[1])} in ${expenses.filter((e) => e.categoryId === top[0]).length} Buchungen`, private: `${expenses.filter((e) => e.categoryId === top[0]).length} Buchungen` }],
    })
  }

  // 3 Most expensive week (month) or month (year) and day
  const buckets = new Map<string, number>()
  for (const e of expenses) {
    const key = yearly ? monthOf(e.date) : weekStart(e.date)
    buckets.set(key, (buckets.get(key) ?? 0) + e.amount)
  }
  const days = new Map<string, number>()
  for (const e of expenses) days.set(e.date, (days.get(e.date) ?? 0) + e.amount)
  const dearestBucket = [...buckets].sort((a, b) => b[1] - a[1])[0]
  const dearestDay = [...days].sort((a, b) => b[1] - a[1])[0]
  if (dearestBucket && dearestDay) {
    const biggest = expenses.filter((e) => e.date === dearestDay[0]).sort((a, b) => b.amount - a.amount).slice(0, 3)
    const bucketText = yearly ? monthLabel(dearestBucket[0]).split(' ')[0] : `Woche ab ${formatDate(dearestBucket[0]).slice(0, 6)}`
    cards.push({
      key: 'dearest', colors: color(), eyebrow: yearly ? 'Dein teuerster Monat' : 'Deine teuerste Woche', big: bucketText, title: euro(dearestBucket[1]), titlePrivate: `${pct(dearestBucket[1] / s.expense)} der Ausgaben`,
      bigPrivate: bucketText,
      lines: [
        { text: `Teuerster Tag: ${formatDate(dearestDay[0])} mit ${euro(dearestDay[1])}`, private: `Teuerster Tag: ${formatDate(dearestDay[0])}` },
        ...biggest.map((e) => ({ text: `${e.merchant || e.note || catName(e.categoryId)}: ${euro(e.amount)}`, private: e.merchant || e.note || catName(e.categoryId) })),
      ],
    })
  }

  // 4 and 5 Biggest fall and rise against the previous period
  const before = new Map<string, number>()
  for (const e of previous.filter((x) => x.type === 'expense')) before.set(e.categoryId, (before.get(e.categoryId) ?? 0) + e.amount)
  const ids = new Set([...byCategory.keys(), ...before.keys()])
  const changes = [...ids].map((id) => ({ id, now: byCategory.get(id) ?? 0, was: before.get(id) ?? 0 })).map((c) => ({ ...c, diff: c.now - c.was }))
  const fall = changes.filter((c) => c.was > 0 && c.diff < 0).sort((a, b) => a.diff - b.diff)[0]
  const rise = changes.filter((c) => c.diff > 0 && c.was > 0).sort((a, b) => b.diff - a.diff)[0]
  if (fall) {
    cards.push({
      key: 'fall', colors: color(), eyebrow: 'Hier hast du gespart', big: catName(fall.id), title: `${euro(-fall.diff)} weniger als im ${prevName}`, titlePrivate: `${pct(-fall.diff / fall.was)} weniger als im ${prevName}`,
      bigPrivate: catName(fall.id),
      lines: [{ text: `${euro(fall.now)} statt ${euro(fall.was)}`, private: '' }],
    })
  }
  if (rise) {
    cards.push({
      key: 'rise', colors: color(), eyebrow: 'Hier wurde es mehr', big: catName(rise.id), title: `${euro(rise.diff)} mehr als im ${prevName}`, titlePrivate: `${pct(rise.diff / rise.was)} mehr als im ${prevName}`,
      bigPrivate: catName(rise.id),
      lines: [{ text: `${euro(rise.now)} statt ${euro(rise.was)}`, private: '' }],
    })
  }

  // 6 Overall comparison
  if (p.expense > 0) {
    const ratio = (s.expense - p.expense) / p.expense
    cards.push({
      key: 'compare', colors: color(), eyebrow: `Im Vergleich zum ${prevName}`, bigPrivate: `${ratio > 0 ? '↑' : ratio < 0 ? '↓' : '='} ${pct(Math.abs(ratio))}`, big: `${ratio > 0 ? '↑' : ratio < 0 ? '↓' : '='} ${pct(Math.abs(ratio))}`,
      title: ratio > 0 ? 'mehr ausgegeben' : ratio < 0 ? 'weniger ausgegeben' : 'gleich viel ausgegeben',
      lines: [
        { text: `${euro(s.expense)} statt ${euro(p.expense)}`, private: '' },
        ...(s.savingsRate !== null && p.savingsRate !== null ? [{ text: `Sparquote ${pct(s.savingsRate)} statt ${pct(p.savingsRate)}` }] : []),
      ],
    })
  }

  // 7 Most frequent merchant
  const merchants = new Map<string, number>()
  for (const e of expenses) if (e.merchant?.trim()) merchants.set(e.merchant.trim(), (merchants.get(e.merchant.trim()) ?? 0) + 1)
  const favourite = [...merchants].sort((a, b) => b[1] - a[1])[0]
  if (favourite && favourite[1] >= 2) {
    const spent = sum(expenses.filter((e) => e.merchant?.trim() === favourite[0]))
    cards.push({
      key: 'merchant', colors: color(), eyebrow: 'Dein Lieblingsladen', big: favourite[0], title: `${favourite[1]}× besucht`,
      bigPrivate: favourite[0],
      lines: [{ text: `${euro(spent)} insgesamt`, private: '' }, { text: `${current.length} Buchungen im ${yearly ? 'Jahr' : name}` }],
    })
  }

  // 8 Labels
  const labelLines = data.labels
    .map((l) => ({ l, amount: sum(expenses.filter((e) => e.labels?.includes(l.id))) }))
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4)
  if (labelLines.length > 0) {
    cards.push({
      key: 'labels', colors: color(), eyebrow: yearly ? 'Deine Labels des Jahres' : 'Deine Labels des Monats', big: `${labelLines[0].l.symbol === 'emoji' ? `${labelLines[0].l.emoji} ` : ''}${labelLines[0].l.name}`,
      title: euro(labelLines[0].amount), titlePrivate: `${pct(labelLines[0].amount / s.expense)} der Ausgaben`, bigPrivate: labelLines[0].l.name,
      lines: labelLines.slice(1).map((x) => ({ text: `${x.l.name}: ${euro(x.amount)}`, private: x.l.name })),
    })
  }

  // 9 Budgets and goals
  const months = yearly ? Array.from({ length: 12 }, (_, i) => `${period.key}-${String(i + 1).padStart(2, '0')}`).filter((m) => m <= monthOf(data.now)) : [period.key]
  const checks: boolean[] = []
  for (const c of categories.filter((x) => x.type === 'expense' && x.budget)) for (const m of months) checks.push(monthProgress(data.entries, new Set([c.id]), c.budget!, m, data.now, euro).level !== 'over')
  for (const g of data.groups.filter((x) => x.type === 'expense' && x.budget)) for (const m of months) checks.push(monthProgress(data.entries, groupCategoryIds(g, categories), g.budget!, m, data.now, euro).level !== 'over')
  const goals = data.goals.filter((g) => !g.archived && g.start <= to).map((goal) => ({ goal, p: goalProgress(data.entries, goal, to < data.now ? to : data.now) }))
  if (checks.length > 0 || goals.length > 0) {
    const kept = checks.filter(Boolean).length
    cards.push({
      key: 'budgets', colors: color(), eyebrow: 'Budgets & Ziele', big: checks.length > 0 ? `${kept} von ${checks.length}` : `${goals.length}`,
      bigPrivate: checks.length > 0 ? `${kept} von ${checks.length}` : `${goals.length}`,
      title: checks.length > 0 ? (yearly ? 'Monatsbudgets eingehalten' : 'Budgets eingehalten') : goals.length === 1 ? 'Sparziel' : 'Sparziele',
      lines: goals.map(({ goal, p: gp }) => ({ text: `${goal.emoji} ${goal.name}: ${pct(gp.ratio)} (${euro(gp.saved)})`, private: `${goal.emoji} ${goal.name}: ${pct(gp.ratio)}` })),
    })
  }

  // 10 Fun fact
  const cheapest = [...days].sort((a, b) => a[1] - b[1])[0]
  let span = 0
  for (let d = from; d <= (to < data.now ? to : data.now); d = addDays(d, 1)) span++
  const free = span - days.size
  const fact = favourite && favourite[1] >= 4
    ? { big: `${favourite[1]}×`, title: `warst du bei ${favourite[0]}`, line: `Im Schnitt ${euro(Math.round(sum(expenses.filter((e) => e.merchant?.trim() === favourite[0])) / favourite[1]))} pro Besuch`, privateLine: '' }
    : free >= 3
      ? { big: `${free}`, title: free === 1 ? 'Tag ganz ohne Ausgaben' : 'Tage ganz ohne Ausgaben', line: cheapest ? `Dein günstigster Tag: ${formatDate(cheapest[0])} mit ${euro(cheapest[1])}` : '', privateLine: '' }
      : cheapest ? { big: euro(cheapest[1]), title: `an deinem günstigsten Tag, dem ${formatDate(cheapest[0])}`, line: '', privateLine: '' } : null
  if (fact) {
    cards.push({ key: 'fact', colors: color(), eyebrow: 'Fun Fact', big: fact.big, bigPrivate: fact.big.includes('€') ? '💡' : fact.big, title: fact.title, titlePrivate: fact.big.includes('€') ? 'dein günstigster Tag' : undefined, lines: fact.line ? [{ text: fact.line, private: fact.privateLine }] : [] })
  }

  // 11 Closing
  const ahead = goals.find((g) => !g.p.reached && g.p.forecast?.startsWith('Bei deiner'))
  const outlook = ahead
    ? `Wenn du so weitermachst, erreichst du „${ahead.goal.name}“ im ${monthLabel(ahead.p.forecast!.match(/(\d\d)\.(\d\d)\.(\d{4})/)!.slice(1).reverse().join('-').slice(0, 7))}.`
    : s.savingsRate !== null && s.savingsRate > 0 ? `Du hast ${pct(s.savingsRate)} deiner Einnahmen gespart. Weiter so!` : 'Neuer Monat, neue Chance.'
  cards.push({
    key: 'end', colors: color(), eyebrow: yearly ? `${name} in einem Satz` : `Dein ${name} in einem Satz`,
    big: s.rest >= 0 ? `+${euro(s.rest)}` : `−${euro(-s.rest)}`, bigPrivate: s.savingsRate === null ? '–' : pct(s.savingsRate),
    title: s.rest >= 0 ? 'blieben übrig' : 'mehr ausgegeben als eingenommen', titlePrivate: 'Sparquote',
    lines: [{ text: outlook }],
  })
  return cards
}
