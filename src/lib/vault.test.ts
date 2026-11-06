import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, DEFAULT_CATEGORIES, newId, type Category, type Entry, type Recurring } from '../db'
import { bookDueEntries } from './booking'
import {
  changeCode, checkCode, closeSession, getKeyring, isSignedIn, prepareSetup, resetDevice, setupVault, signIn, signOut, startState, store,
  unlockOnDevice, unlockWithCode, waitAfter, whenSaved,
} from './vault'

const CODE = 'Sommer2026!'

/** Categories as the version before the update stored them */
const v2Categories = (): Category[] => DEFAULT_CATEGORIES
  .filter((c) => ['exp-supermarkt', 'exp-food', 'exp-restaurants', 'exp-drogerie', 'exp-shopping', 'exp-sport', 'exp-freizeit', 'exp-vacation', 'exp-mobility', 'exp-studium', 'exp-abos', 'exp-diverse', 'sav-investitionen', 'inc-income', 'inc-parents', 'inc-oma'].includes(c.id))
  .map(({ icon: _icon, groupId: _group, ...c }, i) => ({ ...c, order: i, name: c.id === 'exp-mobility' ? 'Mobility/Auto' : c.name, color: c.id === 'exp-mobility' ? '#5b6b82' : '#123456' }))

const entry = (over: Partial<Entry>): Entry => ({
  id: newId(), type: 'expense', amount: 1000, categoryId: 'exp-food', date: '2026-10-15', createdAt: 1, ...over,
})

const legacyEntries = [
  entry({ categoryId: 'exp-mobility', amount: 5800, note: 'Tanken' }),
  entry({ categoryId: 'exp-food', amount: 1250, note: 'Burger', merchant: 'Hans im Glück' }),
  entry({ categoryId: 'own-hobby', amount: 999, note: 'Wolle' }),
  entry({ type: 'income', categoryId: 'inc-parents', amount: 30000 }),
]
const legacyRecurring: Recurring = {
  id: 'r-miete', name: 'Miete', amount: 42000, type: 'expense', categoryId: 'exp-diverse',
  interval: 'monthly', bookingDay: 1, startDate: '2026-01-01', paused: false, nextDue: '2026-12-01',
}

/** Builds the unencrypted database of the previous version, as it is on the iPhone now */
async function installVersion2(withPin = false) {
  const old = new Dexie('budget')
  old.version(1).stores({ categories: 'id, type, order', entries: 'id, date, [type+date], categoryId, recurringId, &recurringKey', recurring: 'id, categoryId', meta: 'key' })
  old.version(2).stores({})
  await old.open()
  await old.table('categories').bulkAdd([...v2Categories(), { id: 'own-hobby', type: 'expense', name: 'Stricken', emoji: '🧶', color: '#000000', order: 50 }])
  await old.table('entries').bulkAdd(legacyEntries)
  await old.table('recurring').add(legacyRecurring)
  await old.table('meta').bulkAdd([
    { key: 'apiKey', value: 'sk-ant-api-geheim' },
    { key: 'savingsGoal', value: 20 },
    ...(withPin ? [{ key: 'lock', value: { salt: 'AAAA', pinHash: 'x', lockAfter: 0 } }] : []),
  ])
  old.close()
}

/** Simulates closing and reopening the app */
async function restart() {
  await whenSaved()
  closeSession()
  await db.delete()
  await db.open()
}

beforeEach(async () => {
  closeSession()
  await resetDevice()
  await db.delete()
  await db.open()
})

describe('Update der bestehenden Daten', () => {
  it('erkennt die alte App und ihre PIN', async () => {
    await installVersion2(true)
    const state = await startState()
    expect(state.kind).toBe('legacy')
    expect(state.kind === 'legacy' && state.lock?.pinHash).toBe('x')
  })

  it('übernimmt alle Einträge unverändert und ordnet sie den neuen Kategorien zu', async () => {
    await installVersion2()
    const info = await prepareSetup()
    expect(info).toMatchObject({ entries: 4, legacy: true })

    // Every entry keeps id, amount, date and category
    const entries = await db.entries.toArray()
    for (const old of legacyEntries) expect(entries.find((e) => e.id === old.id)).toEqual(old)

    const auto = await db.categories.get('exp-mobility')
    expect(auto).toMatchObject({ name: 'Auto', groupId: 'grp-mobil', icon: 'car-front', color: '#a066cc' })
    expect((await db.categories.get('exp-food'))?.color).toBe('#123456')
    expect(await db.categories.get('own-hobby')).toMatchObject({ name: 'Stricken', symbol: 'emoji' })
    expect((await db.categories.get('own-hobby'))?.groupId).toBeUndefined()
    for (const id of ['exp-geschenke', 'exp-oepnv', 'exp-parken', 'exp-strafzettel', 'exp-eltern', 'inc-rueckzahlung']) {
      expect(await db.categories.get(id)).toBeTruthy()
    }
    expect((await db.categories.get('exp-eltern'))?.groupId).toBeUndefined()
    expect((await db.categories.get('inc-rueckzahlung'))?.groupId).toBe('grp-familie')
    expect((await db.groups.where('type').equals('expense').sortBy('order')).map((g) => g.name)).toEqual(['Essen & Alltag', 'Freizeit & Lifestyle', 'Studium & Abos', 'Mobilität'])

    // Own categories come after the presets, no order twice
    const expenses = await db.categories.where('type').equals('expense').sortBy('order')
    expect(expenses.at(-1)?.id).toBe('own-hobby')
    expect(new Set(expenses.map((c) => c.order)).size).toBe(expenses.length)

    const recurring = await db.recurring.toArray()
    expect(recurring.find((r) => r.id === 'r-miete')).toEqual(legacyRecurring)
    expect(recurring.filter((r) => r.subscription).map((r) => [r.name, r.interval, r.amount, r.paused]).sort()).toEqual([['Claude', 'monthly', 0, true], ['Whoop', 'yearly', 0, true]])

    expect((await db.meta.get('apiKey'))?.value).toBe('sk-ant-api-geheim')
    expect(await db.meta.get('lock')).toBeUndefined()
    const before = (await db.meta.get('preUpdateBackup'))?.value as { entries: Entry[]; categories: Category[] }
    expect(before.entries).toHaveLength(legacyEntries.length)
    expect(before.entries).toEqual(expect.arrayContaining(legacyEntries))
    expect(before.categories.find((c) => c.id === 'exp-mobility')?.name).toBe('Mobility/Auto')
  })

  it('verschlüsselt alles, prüft es und entfernt erst dann die alten Daten', async () => {
    await installVersion2(true)
    await prepareSetup()
    const total = (await db.categories.count()) + (await db.groups.count()) + (await db.entries.count()) + (await db.recurring.count()) + (await db.meta.count())
    const { checked } = await setupVault(CODE)
    expect(checked).toBe(total)

    expect(await store.entries.count()).toBe(0)
    expect(await store.categories.count()).toBe(0)
    expect(await store.meta.count()).toBe(0)
    expect(await store.vault.count()).toBe(total)

    // Nothing readable is left on the device
    const raw = JSON.stringify(await Promise.all((await store.vault.toArray()).map(async (row) => [row.k, new TextDecoder().decode(row.d)])))
    for (const secret of ['Burger', 'Hans im Glück', 'sk-ant-api-geheim', 'Tanken', '42000', 'Miete']) expect(raw).not.toContain(secret)
  })

  it('öffnet die Daten nach einem Neustart nur mit dem richtigen Code', async () => {
    await installVersion2()
    await prepareSetup()
    await setupVault(CODE)
    await restart()
    expect((await startState()).kind).toBe('locked')
    expect(await db.entries.count()).toBe(0)

    expect((await unlockWithCode('sommer2026!')).ok).toBe(false)
    expect(await db.entries.count()).toBe(0)
    expect((await getKeyring())?.failures).toBe(1)
    // A single mistake does not lock the input
    expect((await getKeyring())?.blockedUntil).toBe(0)

    expect((await unlockWithCode(CODE)).ok).toBe(true)
    const entries = await db.entries.toArray()
    for (const old of legacyEntries) expect(entries.find((e) => e.id === old.id)).toEqual(old)
    expect((await db.categories.get('exp-mobility'))?.name).toBe('Auto')
    expect((await getKeyring())?.failures).toBe(0)
  })
})

describe('Speichern im verschlüsselten Speicher', () => {
  beforeEach(async () => {
    await prepareSetup()
    await setupVault(CODE)
  })

  it('übernimmt Hinzufügen, Ändern und Löschen über einen Neustart', async () => {
    const a = entry({ note: 'Kaffee' })
    const b = entry({ note: 'Brot' })
    await db.entries.bulkAdd([a, b])
    await db.entries.update(a.id, { amount: 450 })
    await db.entries.delete(b.id)
    await db.categories.update('exp-food', { name: 'Essen' })
    await restart()
    await unlockWithCode(CODE)
    expect(await db.entries.toArray()).toEqual([{ ...a, amount: 450 }])
    expect((await db.categories.get('exp-food'))?.name).toBe('Essen')
  })

  it('übernimmt Massenlöschungen, Leeren und Transaktionen', async () => {
    await db.entries.bulkAdd([entry({ categoryId: 'exp-sport' }), entry({ categoryId: 'exp-sport' }), entry({ categoryId: 'exp-food', note: 'bleibt' })])
    await db.entries.where('categoryId').equals('exp-sport').delete()
    await db.recurring.clear()
    await db.recurring.add({ ...legacyRecurring, nextDue: '2026-09-01' })
    expect(await bookDueEntries('2026-11-02')).toBe(3)
    await restart()
    await unlockWithCode(CODE)
    expect((await db.entries.toArray()).map((e) => e.note)).toEqual(expect.arrayContaining(['bleibt', 'Miete', 'Miete', 'Miete']))
    expect(await db.entries.count()).toBe(4)
    expect((await db.recurring.toArray()).map((r) => r.nextDue)).toEqual(['2026-12-01'])
  })

  it('verwirft Änderungen einer abgebrochenen Transaktion', async () => {
    await db.transaction('rw', db.entries, async () => {
      await db.entries.add(entry({ note: 'abgebrochen' }))
      throw new Error('Abbruch')
    }).catch(() => {})
    await restart()
    await unlockWithCode(CODE)
    expect(await db.entries.count()).toBe(0)
  })
})

describe('Zugangscode', () => {
  beforeEach(async () => {
    await prepareSetup()
    await setupVault(CODE)
  })

  it('verlangt mindestens 6 Zeichen', async () => {
    await expect(changeCode('12345')).rejects.toThrow('mindestens 6')
  })

  it('wartet nach mehreren falschen Codes immer länger', async () => {
    expect([1, 4, 5, 6, 7, 8, 9, 20].map(waitAfter)).toEqual([0, 0, 30_000, 60_000, 300_000, 900_000, 3_600_000, 3_600_000])
    await restart()
    for (let i = 0; i < 4; i++) expect((await unlockWithCode('falsch')).ok).toBe(false)
    const fifth = await unlockWithCode('falsch')
    expect(fifth.ok === false && fifth.blockedUntil > Date.now() + 25_000).toBe(true)
    // Even the right code waits now
    expect((await unlockWithCode(CODE)).ok).toBe(false)
    expect(await db.entries.count()).toBe(0)
  })

  it('lässt sich im entsperrten Zustand ändern, ohne die Daten neu zu verschlüsseln', async () => {
    await db.entries.add(entry({ note: 'Pizza' }))
    await whenSaved()
    const before = (await store.vault.toArray()).map((r) => r.k).sort()
    await changeCode('NeuerCode1')
    expect((await store.vault.toArray()).map((r) => r.k).sort()).toEqual(before)
    expect(await checkCode(CODE)).toBe(false)
    expect(await checkCode('NeuerCode1')).toBe(true)
    // A check inside the open app counts no mistake
    expect((await getKeyring())?.failures).toBe(0)
    await restart()
    await expect(changeCode('Fremder-Code')).rejects.toThrow('gesperrt')
    expect((await unlockWithCode(CODE)).ok).toBe(false)
    expect((await unlockWithCode('NeuerCode1')).ok).toBe(true)
    expect((await db.entries.toArray())[0].note).toBe('Pizza')
  })
})

describe('Angemeldetes Gerät', () => {
  beforeEach(async () => {
    await prepareSetup()
    await setupVault(CODE)
    await db.entries.add(entry({ note: 'Pizza' }))
  })

  const faceId = (secret: Uint8Array<ArrayBuffer> | null) => ({ credentialId: 'cred', prfSalt: crypto.getRandomValues(new Uint8Array(32)), secret })

  it('ist nach dem Einrichten abgemeldet und sperrt nicht nach Zeit', async () => {
    const ring = (await getKeyring())!
    expect(isSignedIn(ring)).toBe(false)
    expect(ring.lockAfter).toBeNull()
    await restart()
    await expect(unlockOnDevice(null)).rejects.toThrow('abgemeldet')
  })

  it('öffnet ohne Face ID mit einem Geräteschlüssel, der sich nicht exportieren lässt', async () => {
    await signIn(null)
    const ring = (await getKeyring())!
    expect(isSignedIn(ring)).toBe(true)
    expect(ring.faceId).toBeUndefined()
    expect(ring.device?.key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', ring.device!.key)).rejects.toThrow()
    await restart()
    await unlockOnDevice(null)
    expect((await db.entries.toArray())[0].note).toBe('Pizza')
  })

  it('bindet den Schlüssel an das Face-ID-Geheimnis und behält keinen Geräteschlüssel', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    await signIn(faceId(secret))
    const ring = (await getKeyring())!
    expect(ring.device).toBeUndefined()
    expect(ring.faceId?.wrapped).toBeTruthy()
    await restart()
    await expect(unlockOnDevice(null)).rejects.toThrow()
    await expect(unlockOnDevice(crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow()
    expect(await db.entries.count()).toBe(0)
    await unlockOnDevice(secret)
    expect((await db.entries.toArray())[0].note).toBe('Pizza')
  })

  it('nutzt Face ID ohne Geheimnis zusammen mit dem Geräteschlüssel', async () => {
    await signIn(faceId(null))
    const ring = (await getKeyring())!
    expect(ring.faceId).toEqual({ credentialId: 'cred' })
    expect(ring.device).toBeTruthy()
    await restart()
    await unlockOnDevice(null)
    expect(await db.entries.count()).toBe(1)
  })

  it('wechselt zwischen Face ID und ohne Abfrage, ohne Daten zu verlieren', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    await signIn(faceId(secret))
    await signIn(null)
    expect((await getKeyring())?.faceId).toBeUndefined()
    await restart()
    await unlockOnDevice(null)
    await signIn(faceId(secret))
    await restart()
    await unlockOnDevice(secret)
    expect(await db.entries.count()).toBe(1)
  })

  it('braucht nach dem Abmelden wieder den App-Code', async () => {
    await signIn(null)
    await signOut()
    const ring = (await getKeyring())!
    expect(isSignedIn(ring)).toBe(false)
    expect(ring.device).toBeUndefined()
    await restart()
    await expect(unlockOnDevice(null)).rejects.toThrow('abgemeldet')
    expect((await unlockWithCode(CODE)).ok).toBe(true)
    expect((await db.entries.toArray())[0].note).toBe('Pizza')
  })

  it('übernimmt Face ID der Vorversion und schaltet die Sperre nach Zeit aus', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    await signIn(faceId(secret))
    await whenSaved()
    // A keyring as the version from 5 November stored it
    const { version: _version, ...old } = { ...(await getKeyring())!, lockAfter: 300 }
    await store.keyring.put(old)
    closeSession()
    await db.delete()
    await db.open()
    const state = await startState()
    expect(state.kind === 'locked' && state.keyring).toMatchObject({ lockAfter: null, version: 2 })
    expect((await getKeyring())?.lockAfter).toBeNull()
    await unlockOnDevice(secret)
    expect(await db.entries.count()).toBe(1)
    // A choice made later stays
    await store.keyring.update('main', { lockAfter: 60 })
    await startState()
    expect((await getKeyring())?.lockAfter).toBe(60)
  })
})

describe('Neuinstallation', () => {
  it('startet mit Kategorien, Überkategorien und den zwei Abo-Vorlagen', async () => {
    expect((await startState()).kind).toBe('fresh')
    expect(await prepareSetup()).toMatchObject({ legacy: false, entries: 0 })
    expect(await db.categories.count()).toBe(DEFAULT_CATEGORIES.length)
    expect((await db.recurring.toArray()).map((r) => r.name).sort()).toEqual(['Claude', 'Whoop'])
    // Drafts without an amount are never booked
    expect(await bookDueEntries('2030-01-01')).toBe(0)
  })
})
