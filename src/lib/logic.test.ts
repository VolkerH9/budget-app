import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, DEFAULT_CATEGORIES, type Entry, type Recurring } from '../db'
import { bookDueEntries, countBacklog, resumeNextDue } from './booking'
import { addMonths, dayLabel, formatDate, isValidIso, weekday } from './dates'
import { amountToInput, displayInput, formatEuro, formatPercent, parseAmount, pressKey } from './format'
import { dueDates, firstOnOrAfter, nextAfter, type Schedule } from './recurring'
import { budgetLevel, budgetRows, expensesByCategory, monthlySeries, summarize } from './stats'

const plain = (s: string) => s.replace(/ /g, ' ')

const entry = (over: Partial<Entry>): Entry => ({
  id: crypto.randomUUID(), type: 'expense', amount: 100, categoryId: 'exp-supermarkt', date: '2026-11-02', createdAt: 0, ...over,
})

describe('Formate', () => {
  it('zeigt Beträge und Datum im deutschen Format', () => {
    expect(plain(formatEuro(123456))).toBe('1.234,56 €')
    expect(formatDate('2026-03-09')).toBe('09.03.2026')
    expect(plain(formatPercent(0.125))).toBe('12,5 %')
  })
  it('liest Eingaben ohne Rundungsfehler', () => {
    expect(parseAmount('12,5')).toBe(1250)
    expect(parseAmount('0,07')).toBe(7)
    expect(parseAmount('19,99')).toBe(1999)
    expect(parseAmount('1.234,56')).toBe(123456)
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(amountToInput(1250)).toBe('12,5')
    expect(amountToInput(1205)).toBe('12,05')
    expect(amountToInput(1200)).toBe('12')
  })
  it('verhält sich am Ziffernblock richtig', () => {
    const type = (keys: string[]) => keys.reduce(pressKey, '')
    expect(type(['0', '5'])).toBe('5')
    expect(type([',', '5'])).toBe('0,5')
    expect(type(['1', ',', '2', '3', '4'])).toBe('1,23')
    expect(type(['1', ',', ','])).toBe('1,')
    expect(type(['1', '2', 'back'])).toBe('1')
    expect(displayInput('1234,5')).toBe('1.234,5')
    expect(displayInput('')).toBe('0')
  })
  it('kennt Monatswechsel und ungültige Daten', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-01', -13)).toBe('2024-12')
    expect(isValidIso('2026-02-30')).toBe(false)
    expect(isValidIso('2028-02-29')).toBe(true)
    expect(dayLabel('2026-11-02', '2026-11-02')).toBe('Heute')
    expect(dayLabel('2026-11-01', '2026-11-02')).toBe('Gestern')
    expect(dayLabel('2026-10-26', '2026-11-02')).toBe('Mo., 26.10.2026')
  })
})

describe('Dauerauftrag-Termine', () => {
  const monthly: Schedule = { interval: 'monthly', bookingDay: 31, startDate: '2026-01-15' }
  it('nimmt in kurzen Monaten den letzten Tag und findet zurück auf den 31.', () => {
    const first = firstOnOrAfter(monthly, monthly.startDate)
    expect(first).toBe('2026-01-31')
    expect(nextAfter(monthly, first)).toBe('2026-02-28')
    expect(nextAfter(monthly, '2026-02-28')).toBe('2026-03-31')
    expect(nextAfter(monthly, '2026-03-31')).toBe('2026-04-30')
  })
  it('springt in den Folgemonat, wenn der Tag vor dem Start liegt', () => {
    expect(firstOnOrAfter({ interval: 'monthly', bookingDay: 1, startDate: '2026-01-15' }, '2026-01-15')).toBe('2026-02-01')
  })
  it('bucht wöchentlich am gewählten Wochentag', () => {
    const s: Schedule = { interval: 'weekly', bookingDay: 5, startDate: '2026-11-02' }
    const first = firstOnOrAfter(s, s.startDate)
    expect(first).toBe('2026-11-06')
    expect(weekday(first)).toBe(5)
    expect(dueDates(s, first, '2026-11-20')).toEqual(['2026-11-06', '2026-11-13', '2026-11-20'])
  })
  it('rechnet vierteljährlich und jährlich ab dem Startmonat', () => {
    const q: Schedule = { interval: 'quarterly', bookingDay: 15, startDate: '2026-02-01' }
    expect(dueDates(q, firstOnOrAfter(q, q.startDate), '2026-12-31')).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15'])
    const y: Schedule = { interval: 'yearly', bookingDay: 29, startDate: '2028-02-01' }
    expect(dueDates(y, firstOnOrAfter(y, y.startDate), '2030-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28'])
  })
  it('endet am Enddatum', () => {
    const s: Schedule = { interval: 'monthly', bookingDay: 1, startDate: '2026-01-01', endDate: '2026-03-01' }
    expect(dueDates(s, '2026-01-01', '2026-12-01')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})

describe('Automatische Buchung', () => {
  const standing = (over: Partial<Recurring> = {}): Recurring => ({
    id: 'r1', name: 'Miete', amount: 50000, type: 'expense', categoryId: 'exp-diverse',
    interval: 'monthly', bookingDay: 1, startDate: '2026-09-01', paused: false, nextDue: '2026-09-01', ...over,
  })
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('legt die Startkategorien an', async () => {
    expect(await db.categories.count()).toBe(DEFAULT_CATEGORIES.length)
    expect(DEFAULT_CATEGORIES.filter((c) => c.type === 'expense')).toHaveLength(11)
  })
  it('bucht rückwirkend, aber nie doppelt', async () => {
    await db.recurring.add(standing())
    expect(await bookDueEntries('2026-11-02')).toBe(3)
    expect(await bookDueEntries('2026-11-02')).toBe(0)
    expect(await db.entries.count()).toBe(3)
    expect((await db.recurring.get('r1'))?.nextDue).toBe('2026-12-01')
  })
  it('zwei gleichzeitige Läufe erzeugen keine Dopplungen', async () => {
    await db.recurring.add(standing())
    await Promise.all([bookDueEntries('2026-11-02'), bookDueEntries('2026-11-02')])
    expect(await db.entries.count()).toBe(3)
  })
  it('legt gelöschte Buchungen nicht neu an', async () => {
    await db.recurring.add(standing())
    await bookDueEntries('2026-11-02')
    const first = await db.entries.orderBy('date').first()
    await db.entries.delete(first!.id)
    await bookDueEntries('2026-11-03')
    expect(await db.entries.count()).toBe(2)
  })
  it('überspringt bereits vorhandene Buchungen', async () => {
    await db.recurring.add(standing())
    await db.entries.add(entry({ date: '2026-09-01', recurringId: 'r1', recurringKey: 'r1:2026-09-01' }))
    expect(await bookDueEntries('2026-09-30')).toBe(0)
    expect((await db.recurring.get('r1'))?.nextDue).toBe('2026-10-01')
  })
  it('bucht pausierte Aufträge nicht und holt die Pause nicht nach', async () => {
    const r = standing({ paused: true })
    await db.recurring.add(r)
    expect(await bookDueEntries('2026-11-02')).toBe(0)
    expect(resumeNextDue(r, '2026-11-02')).toBe('2026-12-01')
  })
  it('zählt, was beim Anlegen nachgebucht würde', () => {
    expect(countBacklog(standing(), '2026-11-02')).toBe(3)
    expect(countBacklog(standing({ startDate: '2027-01-01' }), '2026-11-02')).toBe(0)
  })
})

describe('Auswertung', () => {
  it('berechnet Rest und Sparquote', () => {
    const s = summarize([
      entry({ type: 'income', amount: 200000 }),
      entry({ type: 'expense', amount: 80000 }),
      entry({ type: 'saving', amount: 30000 }),
    ])
    expect(s.rest).toBe(90000)
    expect(s.savingsRate).toBe(0.15)
    expect(summarize([]).savingsRate).toBeNull()
  })
  it('teilt Ausgaben nach Kategorien auf', () => {
    const shares = expensesByCategory(
      [entry({ amount: 300 }), entry({ amount: 100, categoryId: 'exp-sport' }), entry({ type: 'income', categoryId: 'inc-income' })],
      DEFAULT_CATEGORIES,
    )
    expect(shares.map((s) => [s.category.id, s.share])).toEqual([['exp-supermarkt', 0.75], ['exp-sport', 0.25]])
  })
  it('füllt Monate ohne Einträge mit null', () => {
    const rows = monthlySeries([entry({ date: '2026-09-10', amount: 500 })], '2026-11', 3)
    expect(rows.map((r) => [r.month, r.expense])).toEqual([['2026-09', 500], ['2026-10', 0], ['2026-11', 0]])
  })
  it('warnt ab 80 % und bei Überschreitung', () => {
    expect(budgetLevel(79, 100)).toBe('ok')
    expect(budgetLevel(80, 100)).toBe('warn')
    expect(budgetLevel(100, 100)).toBe('warn')
    expect(budgetLevel(101, 100)).toBe('over')
    const [row] = budgetRows([entry({ amount: 120 })], [{ ...DEFAULT_CATEGORIES[0], budget: 100 }])
    expect(row).toMatchObject({ spent: 120, rest: -20, level: 'over' })
  })
})
