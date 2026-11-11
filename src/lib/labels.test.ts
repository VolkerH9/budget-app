import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, DEFAULT_CATEGORIES, DEFAULT_GROUPS, newId, PARENTS_EXPENSE, PARENTS_REFUND, setMeta, type Entry, type Label } from '../db'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { applyBulk, autoLabels, chosenLabels, daysLeft, isActiveOn, labelSummary } from './labels'
import { DATA_VERSION } from './migrate'
import { statements } from './parents'
import { parentsBalance, withoutParents } from './stats'
import { closeSession, prepareSetup, resetDevice, setupVault, unlockWithCode, whenSaved } from './vault'

const CODE = 'Sommer2026!'

const label = (over: Partial<Label> = {}): Label => ({
  id: newId(), name: 'Skiurlaub Tirol', color: '#4a76c8', emoji: '🏔️', symbol: 'emoji', createdAt: 1, ...over,
})
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: newId(), type: 'expense', amount: 1000, categoryId: 'exp-food', date: '2026-12-20', createdAt: 1, ...over,
})

async function restart() {
  await whenSaved()
  closeSession()
  await db.delete()
  await db.open()
  expect((await unlockWithCode(CODE)).ok).toBe(true)
}

beforeEach(async () => {
  closeSession()
  await resetDevice()
  await db.delete()
  await db.open()
  await prepareSetup()
  await setupVault(CODE)
})

describe('Automatische Labels im Zeitraum', () => {
  const ski = label({ id: 'ski', from: '2026-12-18', to: '2026-12-26' })
  const always = label({ id: 'hand' })
  const old = label({ id: 'old', from: '2026-01-01', to: '2026-01-31' })
  const archived = label({ id: 'arch', from: '2026-12-01', to: '2026-12-31', archived: true })
  const all = [ski, always, old, archived]

  it('wählt nur Labels vor, deren Zeitraum das Buchungsdatum enthält', () => {
    expect(autoLabels(all, '2026-12-18')).toEqual(['ski'])
    expect(autoLabels(all, '2026-12-26')).toEqual(['ski'])
  })
  it('setzt nach dem Enddatum und vor dem Start nichts mehr', () => {
    expect(autoLabels(all, '2026-12-27')).toEqual([])
    expect(autoLabels(all, '2026-12-17')).toEqual([])
  })
  it('setzt Labels ohne Zeitraum und archivierte Labels nie automatisch', () => {
    expect(isActiveOn(always, '2026-12-20')).toBe(false)
    expect(isActiveOn(archived, '2026-12-20')).toBe(false)
  })
  it('Abwählen gilt nur für die eine Buchung', () => {
    const auto = autoLabels(all, '2026-12-20')
    expect(chosenLabels(auto, [], ['ski'])).toEqual([])
    // The next booking starts fresh
    expect(chosenLabels(autoLabels(all, '2026-12-21'), [], [])).toEqual(['ski'])
    expect(chosenLabels(auto, ['hand'], [])).toEqual(['ski', 'hand'])
  })
  it('zählt die verbleibenden Tage mit dem heutigen', () => {
    expect(daysLeft(ski, '2026-12-23')).toBe(4)
    expect(daysLeft(always, '2026-12-23')).toBeNull()
  })
})

describe('Label-Übersicht', () => {
  it('summiert nach Kategorien und Überkategorien und pro Tag', () => {
    const ski = label({ id: 'ski', from: '2026-12-18', to: '2026-12-27' })
    const list = [
      entry({ labels: ['ski'], amount: 6000, categoryId: 'exp-restaurants' }),
      entry({ labels: ['ski'], amount: 4000, categoryId: 'exp-restaurants' }),
      entry({ labels: ['ski'], amount: 12000, categoryId: 'exp-mobility' }),
      entry({ labels: ['ski'], type: 'income', amount: 2500, categoryId: 'inc-income' }),
      entry({ amount: 99999 }),
    ]
    const s = labelSummary(list, ski, DEFAULT_CATEGORIES, DEFAULT_GROUPS, '2027-01-05')
    expect(s).toMatchObject({ total: 22000, income: 2500, count: 4, days: 10, perDay: 2200 })
    expect(s.byCategory.map((p) => [p.category.id, p.amount, p.count])).toEqual([['exp-mobility', 12000, 1], ['exp-restaurants', 10000, 2]])
    expect(s.byGroup.map((g) => g.label)).toContain('Essen & Alltag')
    // While the period runs, only the days so far count
    expect(labelSummary(list, ski, DEFAULT_CATEGORIES, DEFAULT_GROUPS, '2026-12-21').days).toBe(4)
  })
})

describe('Sammelaktionen', () => {
  const list = [
    entry({ id: 'a', labels: ['ski'] }),
    entry({ id: 'b', labels: ['ski', 'x'], forParents: true }),
    entry({ id: 'c', labels: ['ski'], type: 'income', categoryId: 'inc-income' }),
    entry({ id: 'd', labels: ['ski'], categoryId: PARENTS_EXPENSE }),
  ]
  it('markiert Ausgaben als Eltern-Kosten, ohne die Kategorie zu ändern', () => {
    const changed = applyBulk(list, { kind: 'parents', on: true })
    expect(changed.map((e) => [e.id, e.categoryId, e.forParents])).toEqual([['a', 'exp-food', true]])
    expect(applyBulk(list, { kind: 'parents', on: false }).map((e) => [e.id, e.forParents])).toEqual([['b', undefined]])
  })
  it('ändert die Kategorie nur bei passender Art', () => {
    const restaurants = DEFAULT_CATEGORIES.find((c) => c.id === 'exp-restaurants')!
    expect(applyBulk(list, { kind: 'category', category: restaurants }).map((e) => e.id)).toEqual(['a', 'b', 'd'])
  })
  it('fügt Labels hinzu und entfernt sie', () => {
    expect(applyBulk(list, { kind: 'addLabel', labelId: 'x' }).map((e) => [e.id, e.labels])).toEqual([
      ['a', ['ski', 'x']], ['c', ['ski', 'x']], ['d', ['ski', 'x']],
    ])
    expect(applyBulk(list, { kind: 'removeLabel', labelId: 'ski' }).find((e) => e.id === 'a')?.labels).toBeUndefined()
  })
  it('lässt sich rückgängig machen, weil die alten Buchungen unverändert bleiben', async () => {
    await db.entries.bulkAdd(list)
    const changed = applyBulk(list, { kind: 'parents', on: true })
    const before = list.filter((e) => changed.some((c) => c.id === e.id))
    await db.entries.bulkPut(changed)
    expect((await db.entries.get('a'))?.forParents).toBe(true)
    await db.entries.bulkPut(before)
    expect((await db.entries.get('a'))?.forParents).toBeUndefined()
  })
})

describe('Eltern-Markierung', () => {
  it('zählt markierte Ausgaben anderer Kategorien zu Eltern-Kosten und Abrechnungen', () => {
    const list = [
      entry({ amount: 3000, categoryId: 'exp-restaurants', forParents: true, date: '2026-10-05' }),
      entry({ amount: 2000, categoryId: PARENTS_EXPENSE, date: '2026-10-07' }),
      entry({ amount: 999, categoryId: 'exp-restaurants', date: '2026-10-07' }),
      entry({ type: 'income', amount: 1000, categoryId: PARENTS_REFUND, date: '2026-10-20' }),
    ]
    expect(parentsBalance(list)).toMatchObject({ spent: 5000, refunded: 1000, open: 4000 })
    expect(statements(list, '2026-11-08').statements[0]).toMatchObject({ total: 5000, paid: 1000, status: 'partial' })
    expect(withoutParents(list, true).map((e) => e.amount)).toEqual([999])
  })
})

describe('Migration und Backup', () => {
  it('öffnet Daten der Vorversion ohne Labels und behält alles', async () => {
    await db.entries.add(entry({ id: 'alt', note: 'Vorher' }))
    await setMeta('dataVersion', 4)
    await restart()
    expect((await db.entries.get('alt'))?.note).toBe('Vorher')
    expect(await db.labels.count()).toBe(0)
    expect((await db.meta.get('dataVersion'))?.value).toBe(DATA_VERSION)
  })
  it('speichert Labels verschlüsselt und behält sie nach einem Neustart', async () => {
    await db.labels.add(label({ id: 'ski', from: '2026-12-18', to: '2026-12-26', budget: 80000 }))
    await db.entries.add(entry({ id: 'e', labels: ['ski'], forParents: true }))
    await restart()
    expect(await db.labels.get('ski')).toMatchObject({ name: 'Skiurlaub Tirol', budget: 80000 })
    expect(await db.entries.get('e')).toMatchObject({ labels: ['ski'], forParents: true })
    expect((await db.entries.where('labels').equals('ski').toArray()).map((e) => e.id)).toEqual(['e'])
  })
  it('nimmt Labels ins Backup auf und spielt alte Backups ohne Labels weiter ein', async () => {
    await db.labels.add(label({ id: 'ski' }))
    await db.entries.add(entry({ id: 'e', labels: ['ski'] }))
    const backup = await createBackup()
    await db.labels.clear()
    await restoreBackup(parseBackup(JSON.stringify(backup)))
    expect(await db.labels.get('ski')).toBeTruthy()
    expect((await db.entries.get('e'))?.labels).toEqual(['ski'])
    const old = { ...backup, version: 4, labels: undefined }
    await restoreBackup(parseBackup(JSON.stringify(old)))
    expect(await db.labels.count()).toBe(0)
    expect(await db.entries.count()).toBe(1)
  })
})
