import { PARENTS_EXPENSE, PARENTS_REFUND, type Entry } from '../db'
import { monthRange } from './dates'

const isExpense = (e: Entry) => e.categoryId === PARENTS_EXPENSE && e.type === 'expense'
const isRefund = (e: Entry) => e.categoryId === PARENTS_REFUND && e.type === 'income'
const sum = (entries: Entry[]) => entries.reduce((total, e) => total + e.amount, 0)

/** Parents expenses not ticked off yet, oldest first */
export const openItems = (entries: Entry[]) =>
  entries.filter((e) => isExpense(e) && !e.refunded).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)

/** Above this the exact search would need too much memory; then the oldest items are taken in order */
const EXACT_LIMIT = 200_000

/**
 * The open items a repayment most likely covers. Items that add up exactly
 * to the amount win, and among those the oldest ones. Without an exact match
 * the oldest items are taken as long as they fit into the amount.
 */
export function suggestRefund(open: Entry[], amount: number): string[] {
  const items = [...open].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  if (amount > 0 && amount <= EXACT_LIMIT && items.length <= 60) {
    // reach[i][s]: the items from i on can add up to exactly s
    const reach = Array.from({ length: items.length + 1 }, () => new Uint8Array(amount + 1))
    reach[items.length][0] = 1
    for (let i = items.length - 1; i >= 0; i--) {
      const a = items[i].amount
      const next = reach[i + 1]
      const row = reach[i]
      for (let s = 0; s <= amount; s++) row[s] = next[s] || (s >= a && next[s - a]) ? 1 : 0
    }
    if (reach[0][amount]) {
      // Going from the oldest item, take each one that still allows an exact total
      const chosen: string[] = []
      let rest = amount
      for (let i = 0; i < items.length && rest > 0; i++) {
        if (items[i].amount <= rest && reach[i + 1][rest - items[i].amount]) {
          chosen.push(items[i].id)
          rest -= items[i].amount
        }
      }
      return chosen
    }
  }
  const chosen: string[] = []
  let rest = amount
  for (const item of items) {
    if (item.amount > rest) break
    chosen.push(item.id)
    rest -= item.amount
  }
  return chosen
}

/** Text for the difference between a repayment and the ticked items */
export function refundDifference(amount: number, selected: number, euro: (cents: number) => string): string {
  if (selected === amount) return 'Passt genau'
  return selected > amount ? `${euro(selected - amount)} bleiben offen` : `${euro(amount - selected)} zu viel erhalten`
}

export interface ParentsStatement {
  month: string
  /** Parents expenses of the month, oldest first */
  items: Entry[]
  spent: number
  /** Repayments booked in the month */
  refunds: number
  /** Still open from the months before */
  carry: number
  /** What the parents owe at the end of the month: carry + spent − refunds */
  open: number
}

export function parentsStatement(entries: Entry[], month: string): ParentsStatement {
  const [from, to] = monthRange(month)
  const before = entries.filter((e) => e.date < from)
  const inside = entries.filter((e) => e.date >= from && e.date <= to)
  const items = inside.filter(isExpense).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  const spent = sum(items)
  const refunds = sum(inside.filter(isRefund))
  const carry = sum(before.filter(isExpense)) - sum(before.filter(isRefund))
  return { month, items, spent, refunds, carry, open: carry + spent - refunds }
}
