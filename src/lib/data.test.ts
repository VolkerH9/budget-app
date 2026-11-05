import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, DEFAULT_CATEGORIES, setMeta, type Category, type Entry } from '../db'
import { splitFoodCategory } from './migrate'
import { prepareSetup, resetDevice } from './vault'
import { createBackup, parseBackup, restoreBackup, toCsv } from './backup'
import { hasSampleData, loadSampleData, removeSampleData } from './sample'
import { ScanError, toScanResult } from './scan'

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: crypto.randomUUID(), type: 'expense', amount: 1999, categoryId: 'exp-food', date: '2026-11-02', createdAt: 0, ...over,
})

beforeEach(async () => {
  await resetDevice()
  await db.delete()
  await db.open()
  await prepareSetup()
})

const oldCategories = (): Category[] => DEFAULT_CATEGORIES
  .filter((c) => c.id !== 'exp-restaurants')
  .map((c) => (c.id === 'exp-food' ? { ...c, name: 'Food & Restaurants', emoji: '🍽️', budget: 12000 } : c))

describe('Aufteilung Food & Restaurants', () => {
  it('stellt bestehende Daten beim Update um', async () => {
    await resetDevice()
    const old = new Dexie('budget')
    old.version(1).stores({ categories: 'id, type, order', entries: 'id, date, [type+date], categoryId, recurringId, &recurringKey', recurring: 'id, categoryId', meta: 'key' })
    await old.open()
    await old.table('categories').bulkAdd(oldCategories().map((c, i) => ({ ...c, order: c.type === 'expense' ? i : c.order })))
    await old.table('entries').add(entry({ note: 'Burger' }))
    old.close()
    await prepareSetup()
    const expenses = await db.categories.where('type').equals('expense').sortBy('order')
    expect(expenses.slice(0, 3).map((c) => c.name)).toEqual(['Supermarkt', 'Food', 'Restaurants'])
    expect(expenses).toHaveLength(17)
    expect(new Set(expenses.map((c) => c.order)).size).toBe(17)
    expect(expenses[1]).toMatchObject({ id: 'exp-food', budget: 12000, emoji: '🍔', groupId: 'grp-essen' })
    expect(expenses[2].budget).toBeUndefined()
    expect((await db.entries.toArray())[0]).toMatchObject({ note: 'Burger', categoryId: 'exp-food' })
  })
  it('lässt selbst umbenannte oder gelöschte Kategorien in Ruhe', () => {
    const renamed = oldCategories().map((c) => (c.id === 'exp-food' ? { ...c, name: 'Essen' } : c))
    expect(splitFoodCategory(renamed)).toEqual(renamed)
    const removed = oldCategories().filter((c) => c.id !== 'exp-food')
    expect(splitFoodCategory(removed)).toEqual(removed)
  })
  it('wandelt alte Backups beim Einspielen um', async () => {
    const backup = await createBackup()
    backup.version = 1
    backup.categories = oldCategories()
    await restoreBackup(parseBackup(JSON.stringify(backup)))
    expect((await db.categories.get('exp-food'))?.name).toBe('Food')
    expect(await db.categories.get('exp-restaurants')).toBeTruthy()
  })
})

describe('Backup', () => {
  it('stellt alle Daten wieder her', async () => {
    await db.entries.add(entry({ note: 'Pizza' }))
    await db.categories.add({ id: 'c1', type: 'expense', name: 'Eigene', emoji: '🐶', color: '#000', order: 99, budget: 500 })
    await setMeta('savingsGoal', 20)
    const text = JSON.stringify(await createBackup())
    await db.delete()
    await db.open()
    await restoreBackup(parseBackup(text))
    expect((await db.entries.toArray())[0].note).toBe('Pizza')
    expect((await db.categories.get('c1'))?.budget).toBe(500)
    expect((await db.meta.get('savingsGoal'))?.value).toBe(20)
  })
  it('enthält weder API-Schlüssel noch Zugangscode', async () => {
    await setMeta('apiKey', 'sk-ant-geheim')
    await setMeta('lock', { pinHash: 'geheim' })
    expect(JSON.stringify(await createBackup())).not.toContain('geheim')
  })
  it('lehnt fremde und beschädigte Dateien ab', async () => {
    expect(() => parseBackup('kein json')).toThrow('kein gültiges')
    expect(() => parseBackup('{"app":"andere"}')).toThrow('kein Backup')
    const backup = await createBackup()
    backup.entries = [entry({ amount: -5 })]
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('beschädigt')
    backup.entries = [entry({ categoryId: 'gibt-es-nicht' })]
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('beschädigt')
  })
})

describe('CSV', () => {
  it('passt zu deutschem Excel und entschärft Formeln', () => {
    const csv = toCsv([entry({ note: '=SUMME(A1)', merchant: 'Café; "Süd"' })], DEFAULT_CATEGORIES)
    const line = csv.split('\r\n')[1]
    expect(csv.startsWith('﻿Datum;Art;')).toBe(true)
    expect(line).toBe(`02.11.2026;Ausgabe;;Food;19,99;"Café; ""Süd""";'=SUMME(A1);nein`)
  })
})

describe('Beispieldaten', () => {
  it('lassen sich restlos entfernen, eigene Daten bleiben', async () => {
    await db.entries.add(entry({ note: 'Meins' }))
    await db.categories.update('exp-sport', { budget: 1234 })
    await loadSampleData('2026-11-02')
    expect(await hasSampleData()).toBe(true)
    expect(await db.entries.count()).toBeGreaterThan(90)
    expect((await db.categories.get('exp-supermarkt'))?.budget).toBe(25000)
    await removeSampleData()
    expect(await hasSampleData()).toBe(false)
    expect((await db.entries.toArray()).map((e) => e.note)).toEqual(['Meins'])
    expect(await db.recurring.filter((r) => !!r.sample).count()).toBe(0)
    expect((await db.categories.get('exp-supermarkt'))?.budget).toBeUndefined()
    expect((await db.categories.get('exp-sport'))?.budget).toBe(1234)
  })
  it('liegen nicht in der Zukunft', async () => {
    await loadSampleData('2026-11-02')
    const last = await db.entries.orderBy('date').last()
    expect(last!.date <= '2026-11-02').toBe(true)
  })
})

describe('Scan-Antwort', () => {
  const raw = { readable: true, amount_eur: 12.34, merchant: ' Rewe ', date: '2026-11-01', category_id: 'exp-supermarkt' }
  it('übernimmt gültige Werte in Cent', () => {
    expect(toScanResult(raw, DEFAULT_CATEGORIES, '2026-11-02')).toEqual({ amount: 1234, merchant: 'Rewe', date: '2026-11-01', categoryId: 'exp-supermarkt' })
  })
  it('rundet ohne Fließkommafehler', () => {
    expect(toScanResult({ ...raw, amount_eur: 19.99 }, DEFAULT_CATEGORIES, '2026-11-02').amount).toBe(1999)
  })
  it('verwirft unmögliche Daten und fremde Kategorien', () => {
    const result = toScanResult({ ...raw, date: '2030-01-01', category_id: 'erfunden' }, DEFAULT_CATEGORIES, '2026-11-02')
    expect(result.date).toBeUndefined()
    expect(result.categoryId).toBeUndefined()
    expect(toScanResult({ ...raw, date: '2026-13-45' }, DEFAULT_CATEGORIES, '2026-11-02').date).toBeUndefined()
  })
  it('meldet unlesbare Belege', () => {
    expect(() => toScanResult({ ...raw, readable: false }, DEFAULT_CATEGORIES)).toThrow(ScanError)
    expect(() => toScanResult({ ...raw, amount_eur: null }, DEFAULT_CATEGORIES)).toThrow(ScanError)
    expect(() => toScanResult({ ...raw, amount_eur: 0 }, DEFAULT_CATEGORIES)).toThrow(ScanError)
  })
})
