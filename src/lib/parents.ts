import { PARENTS_EXPENSE, PARENTS_REFUND, type Entry } from '../db'
import { monthOf } from './dates'

const isExpense = (e: Entry) => e.categoryId === PARENTS_EXPENSE && e.type === 'expense'
const isRefund = (e: Entry) => e.categoryId === PARENTS_REFUND && e.type === 'income'
const byDate = (a: Entry, b: Entry) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt

export type StatementStatus = 'open' | 'partial' | 'paid'

/** The part of a repayment that went to one statement */
export interface Payment {
  refund: Entry
  amount: number
}

/**
 * The parents statement of one month. It exists by itself as soon as the month
 * has a parents expense; nothing is stored apart from the entries.
 */
export interface Statement {
  month: string
  /** Parents expenses of the month, oldest first */
  items: Entry[]
  total: number
  paid: number
  open: number
  status: StatementStatus
  payments: Payment[]
  /** The month is not over yet, more expenses may come */
  running: boolean
}

export interface StatementBook {
  /** Oldest first */
  statements: Statement[]
  /** Paid beyond all statements */
  credit: number
}

/**
 * Splits all repayments over the monthly statements. A repayment assigned to a
 * month (`forMonth`) goes there first; anything else, and what is left over,
 * pays the oldest open statement first. So a statement can be paid in parts.
 */
export function statements(entries: Entry[], now: string): StatementBook {
  const items = entries.filter(isExpense).sort(byDate)
  const months = [...new Set(items.map((e) => monthOf(e.date)))].sort()
  const list: Statement[] = months.map((month) => {
    const own = items.filter((e) => monthOf(e.date) === month)
    const total = own.reduce((sum, e) => sum + e.amount, 0)
    return { month, items: own, total, paid: 0, open: total, status: 'open', payments: [], running: month >= monthOf(now) }
  })
  const find = (month: string | undefined) => list.find((s) => s.month === month)
  const pay = (s: Statement, refund: Entry, amount: number) => {
    s.paid += amount
    s.open -= amount
    const known = s.payments.find((p) => p.refund.id === refund.id)
    if (known) known.amount += amount
    else s.payments.push({ refund, amount })
  }

  const refunds = entries.filter(isRefund).sort(byDate)
  const rest = new Map<string, number>()
  for (const r of refunds) {
    const target = find(r.forMonth)
    const amount = target ? Math.min(r.amount, target.open) : 0
    if (amount > 0) pay(target!, r, amount)
    rest.set(r.id, r.amount - amount)
  }
  let credit = 0
  for (const r of refunds) {
    let left = rest.get(r.id)!
    for (const s of list) {
      if (left === 0) break
      const amount = Math.min(left, s.open)
      if (amount > 0) {
        pay(s, r, amount)
        left -= amount
      }
    }
    credit += left
  }
  for (const s of list) s.status = s.open === 0 ? 'paid' : s.paid > 0 ? 'partial' : 'open'
  return { statements: list, credit }
}

export const STATUS_LABEL: Record<StatementStatus, string> = { open: 'offen', partial: 'teilweise bezahlt', paid: 'bezahlt' }

/** Ids of parents expenses that count as refunded: ticked by hand, or their statement is paid */
export function settledItems(book: StatementBook): Set<string> {
  const ids = new Set<string>()
  for (const s of book.statements) for (const e of s.items) if (e.refunded || s.status === 'paid') ids.add(e.id)
  return ids
}

/** What a repayment does to a statement, for the sheet that assigns it */
export function paymentEffect(open: number, amount: number, euro: (cents: number) => string): string {
  if (amount < open) return `Danach noch ${euro(open - amount)} offen`
  if (amount === open) return 'Danach ganz bezahlt'
  return `Ganz bezahlt, ${euro(amount - open)} gehen an die nächste offene Abrechnung`
}
