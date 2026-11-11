import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, DEFAULT_CATEGORIES, DEFAULT_GROUPS, newId, type Entry, type Goal, type PeriodBudget } from '../db'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { daysIn, goalProgress, labelProgress, monthProgress, periodProgress, periodWindow, quarterOf, rank, spendForecast } from './budgets'
import { formatEuro } from './format'
import { DATA_VERSION } from './migrate'
import { closeSession, prepareSetup, resetDevice, setupVault, unlockWithCode, whenSaved } from './vault'
import { setMeta } from '../db'

const CODE = 'Sommer2026!'
const entry = (over: Partial<Entry> = {}): Entry => ({ id: newId(), type: 'expense', amount: 1000, categoryId: 'exp-shopping', date: '2026-11-03', createdAt: 1, ...over })

describe('Zeiträume', () => {
  it('kennt Quartale und Jahre', () => {
    expect(quarterOf('2026-11-11')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(quarterOf('2026-02-28')).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    const year: PeriodBudget = { id: 'y', scope: 'category', targetId: 'exp-vacation', amount: 200000, period: 'year', createdAt: 1 }
    expect(periodWindow(year, '2026-11-11')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(daysIn('2026-11-01', '2026-11-30')).toBe(30)
    expect(daysIn('2026-03-28', '2026-04-02')).toBe(6)
  })
})

describe('Prognose', () => {
  const nov = { from: '2026-11-01', to: '2026-11-30' }
  it('schweigt vor dem 5. Tag', () => {
    expect(spendForecast(10000, 20000, nov, '2026-11-04', formatEuro)).toBeNull()
    expect(spendForecast(10000, 20000, nov, '2026-11-05', formatEuro)).not.toBeNull()
  })
  it('nennt den Tag, an dem das Budget bei diesem Tempo überschritten wird', () => {
    // 100 € in 10 days = 10 €/day; 200 € budget runs out on day 20
    expect(spendForecast(10000, 20000, nov, '2026-11-10', formatEuro)).toBe('Bei diesem Tempo überschreitest du das Budget am 20.11.')
  })
  it('sagt, wie viel voraussichtlich übrig bleibt', () => {
    // 30 € in 10 days = 3 €/day, 90 € by month end
    expect(spendForecast(3000, 20000, nov, '2026-11-10', formatEuro)).toBe(`Voraussichtlich ${formatEuro(11000)} unter Budget`)
  })
  it('schweigt, wenn das Budget schon überschritten oder der Zeitraum vorbei ist', () => {
    expect(spendForecast(30000, 20000, nov, '2026-11-10', formatEuro)).toBeNull()
    expect(spendForecast(3000, 20000, nov, '2026-12-01', formatEuro)).toBeNull()
  })
})

describe('Budgets', () => {
  const entries = [
    entry({ amount: 25000, categoryId: 'exp-supermarkt', date: '2026-11-02' }),
    entry({ amount: 9000, categoryId: 'exp-restaurants', date: '2026-11-05' }),
    entry({ amount: 5000, categoryId: 'exp-food', date: '2026-10-30' }),
    entry({ amount: 12000, categoryId: 'exp-shopping', date: '2026-10-10' }),
    entry({ amount: 14000, categoryId: 'exp-shopping', date: '2026-11-08' }),
    entry({ amount: 99999, categoryId: 'exp-shopping', date: '2026-09-30' }),
  ]
  it('rechnet Überkategorien über alle ihre Kategorien, gelb ab 80 %, rot drüber', () => {
    const essen = new Set(DEFAULT_CATEGORIES.filter((c) => c.groupId === 'grp-essen').map((c) => c.id))
    const p = monthProgress(entries, essen, 40000, '2026-11', '2026-11-11', formatEuro)
    expect(p).toMatchObject({ spent: 34000, rest: 6000, level: 'warn' })
    expect(monthProgress(entries, essen, 30000, '2026-11', '2026-11-11', formatEuro).level).toBe('over')
    expect(monthProgress(entries, essen, 60000, '2026-11', '2026-11-11', formatEuro).level).toBe('ok')
  })
  it('rechnet Quartals-Budgets nur im laufenden Quartal', () => {
    const b: PeriodBudget = { id: 'q', scope: 'category', targetId: 'exp-shopping', amount: 30000, period: 'quarter', createdAt: 1 }
    expect(periodProgress(entries, b, DEFAULT_CATEGORIES, DEFAULT_GROUPS, '2026-11-11', formatEuro)).toMatchObject({ spent: 26000, level: 'warn' })
    const custom: PeriodBudget = { ...b, period: 'custom', from: '2026-09-01', to: '2026-09-30' }
    expect(periodProgress(entries, custom, DEFAULT_CATEGORIES, DEFAULT_GROUPS, '2026-11-11', formatEuro)).toMatchObject({ spent: 99999, level: 'over', forecast: null })
    const group: PeriodBudget = { ...b, scope: 'group', targetId: 'grp-essen', period: 'year', amount: 100000 }
    expect(periodProgress(entries, group, DEFAULT_CATEGORIES, DEFAULT_GROUPS, '2026-11-11', formatEuro).spent).toBe(39000)
  })
  it('rechnet Label-Budgets mit Prognose im Zeitraum des Labels', () => {
    const ski = { id: 'ski', name: 'Ski', color: '#000', emoji: '⛷️', symbol: 'emoji' as const, createdAt: 1, budget: 80000, from: '2026-11-01', to: '2026-11-20' }
    const list = [entry({ labels: ['ski'], amount: 50000, date: '2026-11-02' }), entry({ amount: 7777 })]
    const p = labelProgress(list, ski, '2026-11-10', formatEuro)
    expect(p).toMatchObject({ spent: 50000, rest: 30000 })
    expect(p.forecast).toBe('Bei diesem Tempo überschreitest du das Budget am 16.11.')
  })
})

describe('Sparziele', () => {
  const goal: Goal = { id: 'g', name: 'Skiurlaub', emoji: '🏔️', target: 150000, start: '2026-09-01', due: '2027-02-28', initial: 20000, createdAt: 1 }
  const savings = [
    entry({ type: 'saving', categoryId: 'sav-investitionen', amount: 20000, date: '2026-09-15' }),
    entry({ type: 'saving', categoryId: 'sav-investitionen', amount: 20000, date: '2026-10-15' }),
    entry({ type: 'saving', categoryId: 'sav-investitionen', amount: 5000, date: '2026-08-15' }),
    entry({ type: 'saving', categoryId: 'sav-other', amount: 7000, date: '2026-10-20' }),
  ]
  it('zeigt Gespartes, Fehlendes und die nötige Monatsrate', () => {
    const p = goalProgress(savings, goal, '2026-11-01')
    expect(p).toMatchObject({ saved: 67000, missing: 83000, reached: false, overdue: false })
    // 83000 over 120 days (about 3.94 months)
    expect(p.monthlyRate).toBe(Math.ceil(83000 / (120 / 30.44)))
  })
  it('zählt nur die gewählten Sparkategorien', () => {
    expect(goalProgress(savings, { ...goal, categoryIds: ['sav-investitionen'] }, '2026-11-01').saved).toBe(60000)
  })
  it('weiß, ob du im Plan liegst, und sagt den Tag voraus', () => {
    const p = goalProgress(savings, goal, '2026-11-01')
    // Expected on the line: 20000 + 130000 * 62/181 ≈ 64530; saved 67000
    expect(p.onTrack).toBe(true)
    expect(p.level).toBe('ok')
    expect(p.forecast).toMatch(/^Bei deiner aktuellen Rate erreichst du das Ziel am \d\d\.\d\d\.\d{4}/)
    const behind = goalProgress(savings.slice(0, 1), goal, '2026-11-01')
    expect(behind).toMatchObject({ onTrack: false, level: 'warn' })
    expect(behind.forecast).toContain('nach dem Zieldatum')
  })
  it('meldet erreichte und verpasste Ziele', () => {
    expect(goalProgress(savings, { ...goal, target: 50000 }, '2026-11-01')).toMatchObject({ reached: true, forecast: 'Ziel erreicht', monthlyRate: null })
    expect(goalProgress(savings, goal, '2027-03-05')).toMatchObject({ overdue: true, level: 'over' })
  })
  it('sortiert Überschrittenes nach oben', () => {
    const p = (level: 'ok' | 'warn' | 'over', ratio: number) => ({ spent: 0, budget: 1, ratio, rest: 0, level, forecast: null, window: null })
    const order = rank([
      { key: 'a', kind: 'category', name: 'a', progress: p('ok', 0.3) },
      { key: 'b', kind: 'category', name: 'b', progress: p('over', 1.2) },
      { key: 'c', kind: 'category', name: 'c', progress: p('warn', 0.9) },
    ]).map((i) => i.key)
    expect(order).toEqual(['b', 'c', 'a'])
  })
})

describe('Speichern', () => {
  beforeEach(async () => {
    closeSession()
    await resetDevice()
    await db.delete()
    await db.open()
    await prepareSetup()
    await setupVault(CODE)
  })
  it('behält Budgets und Ziele nach einem Neustart und im Backup; alte Daten bleiben', async () => {
    await db.entries.add(entry({ id: 'alt' }))
    await setMeta('dataVersion', 5)
    await db.groups.update('grp-essen', { budget: 40000 })
    await db.budgets.add({ id: 'q', scope: 'category', targetId: 'exp-shopping', amount: 30000, period: 'quarter', createdAt: 1 })
    await db.goals.add({ id: 'g', name: 'Ski', emoji: '🏔️', target: 150000, start: '2026-09-01', due: '2027-02-28', createdAt: 1 })
    await whenSaved()
    closeSession()
    await db.delete()
    await db.open()
    expect((await unlockWithCode(CODE)).ok).toBe(true)
    expect((await db.meta.get('dataVersion'))?.value).toBe(DATA_VERSION)
    expect(await db.entries.get('alt')).toBeTruthy()
    expect((await db.groups.get('grp-essen'))?.budget).toBe(40000)
    expect(await db.budgets.count()).toBe(1)
    expect(await db.goals.get('g')).toMatchObject({ target: 150000 })
    const backup = await createBackup()
    await db.goals.clear()
    await db.budgets.clear()
    await restoreBackup(parseBackup(JSON.stringify(backup)))
    expect(await db.goals.count()).toBe(1)
    expect(await db.budgets.count()).toBe(1)
    await restoreBackup(parseBackup(JSON.stringify({ ...backup, version: 5, goals: undefined, budgets: undefined })))
    expect(await db.goals.count()).toBe(0)
  })
})
