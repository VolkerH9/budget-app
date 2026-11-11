import 'fake-indexeddb/auto'
import ExcelJS from 'exceljs'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, DEFAULT_CATEGORIES, DEFAULT_GROUPS, newId, PARENTS_EXPENSE, PARENTS_REFUND, setMeta, type Entry, type Goal, type Label, type Recurring } from '../db'
import { checkPurchase, monthForecast, type AffordData } from './afford'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { statementCsv, statementXlsx } from './exports'
import { formatEuro } from './format'
import { DATA_VERSION } from './migrate'
import { activeFilters, EMPTY_FILTER, filterEntries, summarizeSelection } from './selection'
import { buildStatement, fileBase, finishedPeriods, type StatementInput } from './statement'
import { closeSession, prepareSetup, resetDevice, setupVault, unlockWithCode, whenSaved } from './vault'
import { buildWrapped, hasWrapped } from './wrapped'

const entry = (over: Partial<Entry> = {}): Entry => ({ id: newId(), type: 'expense', amount: 1000, categoryId: 'exp-food', date: '2026-10-10', createdAt: 1, ...over })
const ski: Label = { id: 'ski', name: 'Skiurlaub', color: '#4a76c8', emoji: '🏔️', symbol: 'emoji', createdAt: 1, budget: 30000 }

describe('Individuell: filtern und zusammenrechnen', () => {
  const list = [
    entry({ id: 'a', amount: 1200, categoryId: 'exp-restaurants', date: '2026-10-02', merchant: 'Da Mario', labels: ['ski'] }),
    entry({ id: 'b', amount: 4500, categoryId: 'exp-supermarkt', date: '2026-10-05', merchant: 'Rewe' }),
    entry({ id: 'c', amount: 800, categoryId: 'exp-food', date: '2026-10-20' }),
    entry({ id: 'd', amount: 200000, type: 'income', categoryId: 'inc-income', date: '2026-10-01' }),
    entry({ id: 'e', amount: 3000, categoryId: 'exp-restaurants', date: '2026-11-03', labels: ['ski'] }),
  ]
  it('filtert nach Kategorien, Labels, Zeitraum, Art, Suche und Betrag', () => {
    const ids = (f: Partial<typeof EMPTY_FILTER>) => filterEntries(list, { ...EMPTY_FILTER, ...f }).map((e) => e.id).sort()
    expect(ids({ categoryIds: ['exp-restaurants', 'exp-food'] })).toEqual(['a', 'c', 'e'])
    expect(ids({ labelIds: ['ski'] })).toEqual(['a', 'e'])
    expect(ids({ from: '2026-10-03', to: '2026-10-31' })).toEqual(['b', 'c'])
    expect(ids({ type: 'income' })).toEqual(['d'])
    expect(ids({ query: 'rewe' })).toEqual(['b'])
    expect(ids({ min: 1000, max: 4000 })).toEqual(['a', 'e'])
    expect(activeFilters({ ...EMPTY_FILTER, categoryIds: ['x'], min: 1 })).toBe(2)
  })
  it('rechnet Summe, Anzahl, Durchschnitt, Zeitraum und Aufteilung', () => {
    const s = summarizeSelection(list.filter((e) => ['a', 'b', 'c', 'e'].includes(e.id)), DEFAULT_CATEGORIES)
    expect(s).toMatchObject({ count: 4, total: 9500, income: 0, average: 2375, first: '2026-10-02', last: '2026-11-03' })
    expect(s.parts.map((p) => [p.categoryId, p.amount, p.count])).toEqual([['exp-supermarkt', 4500, 1], ['exp-restaurants', 4200, 2], ['exp-food', 800, 1]])
    expect(summarizeSelection(list.filter((e) => e.id === 'd'), DEFAULT_CATEGORIES)).toMatchObject({ total: 0, income: 200000 })
  })
})

const recurring: Recurring[] = [
  { id: 'miete', name: 'Miete', amount: 50000, type: 'expense', categoryId: 'exp-diverse', interval: 'monthly', bookingDay: 1, startDate: '2026-01-01', paused: false, nextDue: '2026-12-01' },
  { id: 'netflix', name: 'Netflix', amount: 1299, type: 'expense', categoryId: 'exp-abos', interval: 'monthly', bookingDay: 25, startDate: '2026-01-25', paused: false, nextDue: '2026-11-25', subscription: {} },
]
const history: Entry[] = [
  ...['2026-08', '2026-09', '2026-10'].flatMap((m) => [
    entry({ type: 'income', categoryId: 'inc-income', amount: 200000, date: `${m}-01` }),
    entry({ amount: 50000, categoryId: 'exp-diverse', date: `${m}-01`, recurringId: 'miete' }),
    entry({ amount: 60000, categoryId: 'exp-supermarkt', date: `${m}-15` }),
    entry({ type: 'saving', categoryId: 'sav-investitionen', amount: 20000, date: `${m}-02` }),
  ]),
  entry({ type: 'income', categoryId: 'inc-income', amount: 200000, date: '2026-11-01' }),
  entry({ amount: 50000, categoryId: 'exp-diverse', date: '2026-11-01', recurringId: 'miete' }),
  entry({ amount: 20000, categoryId: 'exp-supermarkt', date: '2026-11-05' }),
  entry({ type: 'saving', categoryId: 'sav-investitionen', amount: 20000, date: '2026-11-02' }),
]

describe('Endabrechnung', () => {
  const input = (over: Partial<StatementInput> = {}): StatementInput => ({
    entries: history, categories: DEFAULT_CATEGORIES.map((c) => (c.id === 'exp-supermarkt' ? { ...c, budget: 55000 } : c)), groups: DEFAULT_GROUPS,
    labels: [], recurring, budgets: [], goals: [], now: '2026-11-10', euro: formatEuro, ...over,
  })
  it('vergleicht mit dem Vormonat und listet Bereiche, Budgets und größte Ausgaben', () => {
    const s = buildStatement({ kind: 'month', key: '2026-10' }, input())
    expect(s.summary).toMatchObject({ income: 200000, expense: 110000, saving: 20000, rest: 70000 })
    expect(s.comparison.expense).toMatchObject({ current: 110000, previous: 110000, diff: 0 })
    expect(s.groups[0]).toMatchObject({ label: 'Essen & Alltag', amount: 60000, count: 1 })
    expect(s.budgets.find((b) => b.key === 'category:exp-supermarkt')?.progress.level).toBe('over')
    expect(s.top[0].amount).toBe(60000)
    expect(s.standing.map((r) => [r.recurring.name, r.count])).toEqual([['Miete', 1]])
  })
  it('zeigt im Jahr alle 12 Monate, Durchschnitt und eingehaltene Monate', () => {
    const s = buildStatement({ kind: 'year', key: '2026' }, input())
    expect(s.months).toHaveLength(12)
    expect(s.averageExpense).toBe(Math.round((110000 * 3 + 70000) / 4))
    expect(s.cheapest?.month).toBe('2026-11')
    // Budget 550 €: August to October over, January to July and November within
    expect(s.budgets.find((b) => b.key === 'category:exp-supermarkt')?.kept).toEqual({ months: 8, of: 11 })
  })
  it('filtert nach Labels und nennt Labels mit Summe', () => {
    const tagged = [...history, entry({ amount: 7000, labels: ['ski'], date: '2026-10-12' })]
    const s = buildStatement({ kind: 'month', key: '2026-10' }, input({ entries: tagged, labels: [ski] }))
    expect(s.labels.map((l) => [l.label.name, l.amount])).toEqual([['Skiurlaub', 7000]])
    expect(buildStatement({ kind: 'month', key: '2026-10' }, input({ entries: tagged, labels: [ski], labelFilter: ['ski'] })).summary.expense).toBe(7000)
  })
  it('erscheint nach Monats- und Jahresende von selbst und hat einheitliche Dateinamen', () => {
    expect(finishedPeriods('2026-11-01')).toEqual([{ kind: 'month', key: '2026-10' }])
    expect(finishedPeriods('2027-01-03')).toEqual([{ kind: 'month', key: '2026-12' }, { kind: 'year', key: '2026' }])
    expect(fileBase({ kind: 'month', key: '2026-10' })).toBe('Budget_2026-10_Oktober')
    expect(fileBase({ kind: 'year', key: '2026' })).toBe('Budget_2026_Jahresabrechnung')
  })
  it('exportiert Excel mit allen Blättern, Formeln und Labels sowie CSV mit Labels', async () => {
    const tagged = [...history, entry({ amount: 7000, labels: ['ski'], date: '2026-10-12', forParents: true }), entry({ amount: 2500, type: 'income', categoryId: PARENTS_REFUND, date: '2026-10-20' })]
    const s = buildStatement({ kind: 'month', key: '2026-10' }, input({ entries: tagged, labels: [ski], goals: [{ id: 'g', name: 'Ski', emoji: '🏔️', target: 100000, start: '2026-08-01', due: '2027-01-31', createdAt: 1 }] }))
    const context = { statement: s, categories: DEFAULT_CATEGORIES, groups: DEFAULT_GROUPS, labels: [ski], name: 'Max' }
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await statementXlsx(context))
    expect(book.worksheets.map((w) => w.name)).toEqual(['Übersicht', 'Alle Buchungen', 'Kategorien', 'Überkategorien', 'Labels', 'Budgets & Ziele', 'Eltern-Kosten'])
    const all = book.getWorksheet('Alle Buchungen')!
    expect(all.getCell('A4').value).toBe('Datum')
    expect(all.getCell('A5').numFmt).toBe('dd.mm.yyyy')
    expect(all.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 })
    const total = all.getCell(`I${5 + s.entries.length}`).value as { formula: string }
    expect(total.formula).toMatch(/^SUBTOTAL\(109,I5:I\d+\)$/)
    expect(book.getWorksheet('Übersicht')!.getCell('B8').value).toEqual({ formula: 'B5-B6-B7' })
    expect(book.getWorksheet('Labels')!.getCell('A5').value).toBe('Skiurlaub')
    expect(book.getWorksheet('Eltern-Kosten')!.getCell('D5').value).toBe(70)
    expect((book.getWorksheet('Budgets & Ziele') as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings.length).toBeGreaterThan(0)
    const csv = statementCsv(context)
    expect(csv.startsWith('﻿Datum;')).toBe(true)
    expect(csv).toContain(';Skiurlaub')
  })
})

describe('Kann ich mir das leisten?', () => {
  const data = (over: Partial<AffordData> = {}): AffordData => ({
    entries: history, categories: DEFAULT_CATEGORIES.map((c) => (c.id === 'exp-shopping' ? { ...c, budget: 15000 } : c)), groups: DEFAULT_GROUPS,
    labels: [ski], recurring, budgets: [], goals: [], savingsGoal: null, hourlyWage: 1500, now: '2026-11-10', ...over,
  })
  it('rechnet den Monat mit festen Abos, Daueraufträgen und dem bisherigen Tempo hoch', () => {
    const f = monthForecast(data(), '2026-11')
    // Booked 700 € of expenses; Netflix still due; groceries 200 € in 10 days, usually 600 € a month, 20 days to go
    expect(f).toMatchObject({ income: 200000, saving: 20000 })
    expect(f.expense).toBe(70000 + 1299 + Math.round(((20000 / 10 + 60000 / 30.44) / 2) * 20))
  })
  it('zeigt Grün, wenn es locker passt, mit Arbeitsstunden', () => {
    const r = checkPurchase({ amount: 3000, categoryId: 'exp-sport', month: '2026-11', spread: 1 }, data(), formatEuro)
    expect(r.light).toBe('green')
    expect(r.reason).toMatch(/^Passt locker/)
    expect(r.hours).toBe(2)
  })
  it('zeigt Gelb ab 80 % eines Budgets und Rot, wenn es gesprengt wird', () => {
    expect(checkPurchase({ amount: 12500, categoryId: 'exp-shopping', month: '2026-11', spread: 1 }, data(), formatEuro).light).toBe('yellow')
    const red = checkPurchase({ amount: 16000, categoryId: 'exp-shopping', month: '2026-11', spread: 1 }, data(), formatEuro)
    expect(red.light).toBe('red')
    expect(red.reason).toBe(`Das sprengt dein Budget „Shopping & Kleidung“ um ${formatEuro(1000)}.`)
    // Spread over 4 months only a quarter lands in November
    expect(checkPurchase({ amount: 16000, categoryId: 'exp-shopping', month: '2026-11', spread: 4 }, data(), formatEuro)).toMatchObject({ monthly: 4000, light: 'green' })
  })
  it('meldet Minus im Monat und ein verfehltes Sparquoten-Ziel', () => {
    expect(checkPurchase({ amount: 200000, categoryId: 'exp-sport', month: '2026-11', spread: 1 }, data(), formatEuro).light).toBe('red')
    const goal = checkPurchase({ amount: 40000, categoryId: 'exp-sport', month: '2026-11', spread: 1 }, data({ savingsGoal: 25 }), formatEuro)
    expect(goal.light).toBe('red')
    expect(goal.reason).toContain('Sparquote')
  })
  it('zählt Label-Budgets und verschiebt Sparziele', () => {
    const goal: Goal = { id: 'g', name: 'Skiurlaub', emoji: '🏔️', target: 200000, start: '2026-08-01', due: '2027-03-01', createdAt: 1 }
    const r = checkPurchase({ amount: 10000, categoryId: 'exp-sport', labelId: 'ski', month: '2026-11', spread: 1 }, data({ goals: [goal] }), formatEuro)
    expect(r.budgets.find((b) => b.kind === 'label')).toMatchObject({ before: 0, after: 10000, budget: 30000 })
    expect(r.goals[0].shiftDays).toBeGreaterThan(0)
    expect(r.goals[0].rateAfter! > r.goals[0].rateBefore!).toBe(true)
  })
  it('verändert keine Daten', async () => {
    await db.entries.clear()
    checkPurchase({ amount: 1000, categoryId: 'exp-sport', month: '2026-11', spread: 1 }, data(), formatEuro)
    expect(await db.entries.count()).toBe(0)
  })
})

describe('Wrapped', () => {
  const month = [
    ...history.filter((e) => e.date.startsWith('2026-10') || e.date.startsWith('2026-09')),
    ...Array.from({ length: 6 }, (_, i) => entry({ amount: 450 + i, categoryId: 'exp-food', merchant: 'Bäcker', date: `2026-10-${String(3 + i).padStart(2, '0')}` })),
    entry({ amount: 7000, labels: ['ski'], categoryId: 'exp-restaurants', date: '2026-10-12' }),
  ]
  it('baut die Karten nur mit genug Daten', () => {
    expect(hasWrapped(month, { kind: 'month', key: '2026-10' })).toBe(true)
    expect(hasWrapped(month, { kind: 'month', key: '2026-07' })).toBe(false)
    expect(buildWrapped({ kind: 'month', key: '2026-07' }, { entries: month, categories: DEFAULT_CATEGORIES, groups: DEFAULT_GROUPS, labels: [], goals: [], now: '2026-11-10', euro: formatEuro })).toEqual([])
  })
  it('enthält Bilanz, Top-Kategorie, teuerste Woche, Vergleich, Händler, Labels, Fun Fact und Abschluss', () => {
    const cards = buildWrapped({ kind: 'month', key: '2026-10' }, { entries: month, categories: DEFAULT_CATEGORIES, groups: DEFAULT_GROUPS, labels: [ski], goals: [], now: '2026-11-10', euro: formatEuro })
    const keys = cards.map((c) => c.key)
    expect(keys[0]).toBe('balance')
    expect(keys.at(-1)).toBe('end')
    for (const key of ['top', 'dearest', 'compare', 'merchant', 'labels', 'fact']) expect(keys).toContain(key)
    expect(cards.find((c) => c.key === 'merchant')).toMatchObject({ big: 'Bäcker', title: '6× besucht' })
    expect(cards.find((c) => c.key === 'fact')?.big).toBe('6×')
    expect(cards.find((c) => c.key === 'top')?.big).toBe('Supermarkt')
  })
  it('hat für jede Karte eine Fassung ohne Beträge', () => {
    const cards = buildWrapped({ kind: 'month', key: '2026-10' }, { entries: month, categories: DEFAULT_CATEGORIES, groups: DEFAULT_GROUPS, labels: [ski], goals: [], now: '2026-11-10', euro: formatEuro })
    for (const c of cards) {
      const big = c.bigPrivate ?? c.big ?? ''
      const title = c.titlePrivate !== undefined ? c.titlePrivate : c.title ?? ''
      const lines = c.lines.map((l) => (l.private !== undefined ? l.private : l.text))
      expect([big, title, ...lines].join(' '), c.key).not.toMatch(/€/)
    }
  })
  it('gibt es auch fürs Jahr', () => {
    const cards = buildWrapped({ kind: 'year', key: '2026' }, { entries: month, categories: DEFAULT_CATEGORIES, groups: DEFAULT_GROUPS, labels: [], goals: [], now: '2026-11-10', euro: formatEuro })
    expect(cards.find((c) => c.key === 'dearest')?.eyebrow).toBe('Dein teuerster Monat')
  })
})

describe('Wunschliste und Speichern', () => {
  beforeEach(async () => {
    closeSession()
    await resetDevice()
    await db.delete()
    await db.open()
    await prepareSetup()
    await setupVault('Sommer2026!')
  })
  it('migriert von Version 6, speichert Wünsche verschlüsselt und im Backup', async () => {
    await db.entries.add(entry({ id: 'alt', categoryId: PARENTS_EXPENSE }))
    await setMeta('dataVersion', 6)
    await db.wishes.add({ id: 'w', name: 'Schuhe', amount: 12000, categoryId: 'exp-shopping', createdAt: 1 })
    await setMeta('hourlyWage', 1500)
    await whenSaved()
    closeSession()
    await db.delete()
    await db.open()
    expect((await unlockWithCode('Sommer2026!')).ok).toBe(true)
    expect((await db.meta.get('dataVersion'))?.value).toBe(DATA_VERSION)
    expect(await db.entries.get('alt')).toBeTruthy()
    expect(await db.wishes.get('w')).toMatchObject({ name: 'Schuhe' })
    const backup = await createBackup()
    expect(backup.settings.hourlyWage).toBe(1500)
    await db.wishes.clear()
    await restoreBackup(parseBackup(JSON.stringify(backup)))
    expect(await db.wishes.count()).toBe(1)
    await restoreBackup(parseBackup(JSON.stringify({ ...backup, version: 6, wishes: undefined })))
    expect(await db.wishes.count()).toBe(0)
    expect(await db.entries.count()).toBe(1)
  })
})
