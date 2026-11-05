import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, DEFAULT_GROUPS, type Entry, type Recurring } from '../db'
import { formatEuro } from './format'
import { dueDates, firstOnOrAfter } from './recurring'
import { compareTree, expenseSegments, monthlySeries, parentsBalance, summarize, withoutParents, yearHighlights } from './stats'
import { monthlyCost, reminders, subscriptionIcs, totals } from './subscriptions'

const entry = (over: Partial<Entry>): Entry => ({
  id: crypto.randomUUID(), type: 'expense', amount: 1000, categoryId: 'exp-supermarkt', date: '2026-11-02', createdAt: 0, ...over,
})

const sub = (over: Partial<Recurring>): Recurring => ({
  id: 's1', name: 'Whoop', amount: 23900, type: 'expense', categoryId: 'exp-abos', interval: 'yearly', bookingDay: 15,
  startDate: '2026-12-15', nextDue: '2026-12-15', paused: false, subscription: {}, ...over,
})

describe('Überkategorien', () => {
  const entries = [
    entry({ categoryId: 'exp-supermarkt', amount: 3000 }),
    entry({ categoryId: 'exp-restaurants', amount: 1000 }),
    entry({ categoryId: 'exp-mobility', amount: 2000 }),
    entry({ categoryId: 'exp-eltern', amount: 4000 }),
    entry({ type: 'income', categoryId: 'inc-rueckzahlung', amount: 2500 }),
  ]
  it('fasst Ausgaben zu Segmenten zusammen, Einzelkategorien bleiben eigene Segmente', () => {
    const segments = expenseSegments(entries, DEFAULT_CATEGORIES, DEFAULT_GROUPS)
    expect(segments.map((s) => [s.label, s.amount])).toEqual([['Essen & Alltag', 4000], ['Eltern', 4000], ['Mobilität', 2000]])
    expect(segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1)
  })
  it('blendet Eltern-Kosten aus Ausgaben, Einnahmen und Sparquote aus', () => {
    const all = summarize(entries)
    const hidden = summarize(withoutParents(entries, true))
    expect([all.expense, all.income]).toEqual([10000, 2500])
    expect([hidden.expense, hidden.income]).toEqual([6000, 0])
    expect(expenseSegments(withoutParents(entries, true), DEFAULT_CATEGORIES, DEFAULT_GROUPS).map((s) => s.label)).not.toContain('Eltern')
  })
  it('rechnet „Offen von Eltern“ als Ausgaben minus Rückzahlungen', () => {
    const balance = parentsBalance([...entries, entry({ categoryId: 'exp-eltern', amount: 1500, refunded: true, date: '2026-12-01' })])
    expect(balance).toMatchObject({ spent: 5500, refunded: 2500, open: 3000 })
    expect(balance.entries[0].date).toBe('2026-12-01')
  })
  it('vergleicht zwei Zeiträume als Baum mit Unterschieden', () => {
    const a = [entry({ categoryId: 'exp-supermarkt', amount: 3000 }), entry({ categoryId: 'exp-sport', amount: 500 })]
    const b = [entry({ categoryId: 'exp-supermarkt', amount: 2000 }), entry({ categoryId: 'exp-diverse', amount: 700 })]
    const tree = compareTree('expense', a, b, DEFAULT_CATEGORIES, DEFAULT_GROUPS)
    expect(tree.map((n) => [n.label, n.a, n.b])).toEqual([['Essen & Alltag', 3000, 2000], ['Freizeit & Lifestyle', 500, 0], ['Diverse', 0, 700]])
    expect(tree[0].children.map((n) => n.label)).toEqual(['Supermarkt'])
  })
  it('findet Highlights im Jahr', () => {
    const year = [entry({ date: '2026-07-03', amount: 9000 }), entry({ date: '2026-03-03', amount: 1000 }), entry({ type: 'income', date: '2026-03-01', amount: 5000 }), entry({ type: 'saving', date: '2026-03-02', amount: 1000, categoryId: 'sav-investitionen' })]
    const rows = monthlySeries(year, '2026-12', 12)
    const tree = compareTree('expense', year, [entry({ amount: 2000, date: '2025-05-01' })], DEFAULT_CATEGORIES, DEFAULT_GROUPS)
    const names = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
    const highlights = yearHighlights(rows, tree, (m) => names[Number(m.slice(5)) - 1], formatEuro)
    expect(highlights.map((h) => [h.label, h.value])).toEqual([['Teuerster Monat', 'Juli'], ['Günstigster Monat', 'März'], ['Beste Sparquote', 'März'], ['Größter Anstieg', 'Essen & Alltag']])
  })
})

describe('Abos', () => {
  it('rechnet jährliche und individuelle Abos auf den Monat um', () => {
    expect(monthlyCost(sub({ amount: 24000 }))).toBe(2000)
    expect(monthlyCost(sub({ interval: 'custom', everyMonths: 3, amount: 3000 }))).toBe(1000)
    const sum = totals([sub({ amount: 24000 }), sub({ interval: 'monthly', amount: 2000 }), sub({ amount: 5000, paused: true }), sub({ amount: 0 })])
    expect(sum).toEqual({ month: 4000, year: 48000 })
  })
  it('bucht „alle 3 Monate“ im richtigen Abstand', () => {
    const s = { interval: 'custom' as const, everyMonths: 3, bookingDay: 31, startDate: '2026-01-31' }
    expect(dueDates(s, firstOnOrAfter(s, s.startDate), '2026-12-31')).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31'])
  })
  it('erinnert vor Verlängerung und vor Ende der Kündigungsfrist', () => {
    const list = [sub({ nextDue: '2026-11-10', subscription: { noticeDays: 30 } }), sub({ id: 's2', name: 'Claude', nextDue: '2026-12-08', subscription: { noticeDays: 30 } }), sub({ id: 's3', nextDue: '2026-11-08', paused: true })]
    expect(reminders(list, 7, '2026-11-05').map((r) => r.text)).toEqual(['Claude: kündigen bis 08.11.2026', 'Whoop verlängert sich am 10.11.2026'])
  })
  it('erzeugt einen Kalendertermin mit Erinnerung', () => {
    const ics = subscriptionIcs(sub({ subscription: { noticeDays: 14, note: 'Kündigen, Konto; prüfen' } }), 7, new Date('2026-11-05T10:00:00Z'))
    expect(ics).toContain('DTSTART;VALUE=DATE:20261215')
    expect(ics).toContain('RRULE:FREQ=YEARLY')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261201')
    expect(ics).toContain('TRIGGER:-P6DT15H')
    expect(ics).toContain('DESCRIPTION:Kündigen\\, Konto\\; prüfen')
    expect(ics.split('BEGIN:VEVENT')).toHaveLength(3)
    expect(subscriptionIcs(sub({ interval: 'monthly', bookingDay: 31 }), 3)).toContain('RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30,31;BYSETPOS=-1')
  })
})
