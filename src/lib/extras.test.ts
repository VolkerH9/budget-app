import 'fake-indexeddb/auto'
import sharp from 'sharp'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, newId, PARENTS_EXPENSE, PARENTS_REFUND, setMeta, type Entry } from '../db'
import { createBackup, createBackupFile, openBackupFile, parseBackup, readSealed, restoreBackup } from './backup'
import { migrateData, renameLeisure } from './migrate'
import { openItems, parentsStatement, refundDifference, suggestRefund } from './parents'
import { monthReport, parentsReport, pdfText } from './pdf'
import { backupState, parentsReportDue, reportMonth } from './reminders'
import { changeCode, closeSession, deletePhotos, loadPhoto, prepareSetup, prunePhotos, resetDevice, savePhotos, setupVault, store, unlockWithCode, whenSaved } from './vault'
import { formatEuro } from './format'

const CODE = 'Sommer2026!'

const entry = (over: Partial<Entry>): Entry => ({
  id: newId(), type: 'expense', amount: 1000, categoryId: 'exp-food', date: '2026-10-15', createdAt: 1, ...over,
})

/** A real JPEG, as the app stores it */
const jpeg = async (width = 600, height = 900, color = { r: 240, g: 240, b: 230 }) =>
  new Blob([new Uint8Array(await sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 70 }).toBuffer())], { type: 'image/jpeg' })

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

describe('Umbenennung Kino & Freizeit', () => {
  it('stellt gespeicherte Daten beim Öffnen um, die Einträge bleiben in der Kategorie', async () => {
    await db.categories.update('exp-freizeit', { name: 'Kino & Freizeit', budget: 4000 })
    const movie = entry({ categoryId: 'exp-freizeit', note: 'Kino', amount: 1200 })
    await db.entries.add(movie)
    await setMeta('dataVersion', 3)
    await restart()
    expect(await db.categories.get('exp-freizeit')).toMatchObject({ name: 'Freizeit', budget: 4000, groupId: 'grp-freizeit' })
    expect(await db.entries.get(movie.id)).toMatchObject({ categoryId: 'exp-freizeit', note: 'Kino', amount: 1200 })
    expect((await db.meta.get('dataVersion'))?.value).toBe(4)
    // Also stored that way, not only in memory
    await restart()
    expect((await db.categories.get('exp-freizeit'))?.name).toBe('Freizeit')
  })
  it('lässt einen selbst gewählten Namen stehen', () => {
    const own = [{ id: 'exp-freizeit', type: 'expense' as const, name: 'Ausgehen', emoji: '🎬', color: '#000', order: 1 }]
    expect(renameLeisure(own)).toEqual(own)
  })
  it('stellt auch alte Backups um', async () => {
    const backup = await createBackup()
    backup.version = 3
    backup.categories = backup.categories.map((c) => (c.id === 'exp-freizeit' ? { ...c, name: 'Kino & Freizeit' } : c))
    await restoreBackup(parseBackup(JSON.stringify(backup)))
    expect((await db.categories.get('exp-freizeit'))?.name).toBe('Freizeit')
    expect(migrateData({ categories: backup.categories, groups: [], entries: [], recurring: [], meta: [] }, 3).categories.find((c) => c.id === 'exp-freizeit')?.name).toBe('Freizeit')
  })
})

describe('Belegfotos', () => {
  it('liegen verschlüsselt auf dem Gerät und überstehen einen Neustart', async () => {
    const photo = await jpeg()
    const bytes = new Uint8Array(await photo.arrayBuffer())
    const e = entry({ photos: ['p1'] })
    await savePhotos([{ id: 'p1', data: photo }])
    await db.entries.add(e)
    const row = await store.photos.get('p1')
    // The stored bytes are not the JPEG (which starts with FF D8)
    expect(new Uint8Array(row!.d).slice(0, 2)).not.toEqual(new Uint8Array([0xff, 0xd8]))
    await restart()
    const back = new Uint8Array(await (await loadPhoto('p1'))!.arrayBuffer())
    expect(back).toEqual(bytes)
    expect((await db.entries.get(e.id))?.photos).toEqual(['p1'])
  })
  it('räumt beim Öffnen Fotos gelöschter Einträge auf, behält die übrigen', async () => {
    await savePhotos([{ id: 'keep', data: await jpeg(10, 10) }, { id: 'old', data: await jpeg(10, 10) }])
    await db.entries.add(entry({ photos: ['keep'] }))
    await restart()
    expect(await store.photos.toCollection().primaryKeys()).toEqual(['keep'])
    expect(await prunePhotos(await db.entries.toArray())).toBe(0)
    await deletePhotos(['keep'])
    expect(await loadPhoto('keep')).toBeNull()
  })
  it('lassen sich nach einem Code-Wechsel weiter öffnen', async () => {
    await savePhotos([{ id: 'p', data: await jpeg(10, 10) }])
    await db.entries.add(entry({ photos: ['p'] }))
    await changeCode('Neuer-Code-1')
    await whenSaved()
    closeSession()
    await db.delete()
    await db.open()
    expect((await unlockWithCode('Neuer-Code-1')).ok).toBe(true)
    expect(await loadPhoto('p')).not.toBeNull()
  })
})

describe('Eltern-Posten abhaken', () => {
  const items = [
    entry({ id: 'a', categoryId: PARENTS_EXPENSE, amount: 1250, date: '2026-10-01' }),
    entry({ id: 'b', categoryId: PARENTS_EXPENSE, amount: 2000, date: '2026-10-05' }),
    entry({ id: 'c', categoryId: PARENTS_EXPENSE, amount: 750, date: '2026-10-09' }),
    entry({ id: 'd', categoryId: PARENTS_EXPENSE, amount: 3000, date: '2026-10-20' }),
  ]
  it('schlägt Posten vor, die genau passen, die ältesten zuerst', () => {
    expect(suggestRefund(items, 3250)).toEqual(['a', 'b'])
    // 2000 + 750 = 2750 is exact; the older 1250 does not fit into an exact total
    expect(suggestRefund(items, 2750)).toEqual(['b', 'c'])
    expect(suggestRefund(items, 7000)).toEqual(['a', 'b', 'c', 'd'])
    // The order of the list does not matter
    expect(suggestRefund([...items].reverse(), 3750)).toEqual(['c', 'd'])
  })
  it('nimmt ohne genauen Treffer die ältesten, solange sie in den Betrag passen', () => {
    expect(suggestRefund(items, 3500)).toEqual(['a', 'b'])
    expect(suggestRefund(items, 1000)).toEqual([])
  })
  it('zeigt den Rest an', () => {
    expect(refundDifference(3500, 3250, formatEuro)).toBe(`${formatEuro(250)} zu viel erhalten`)
    expect(refundDifference(3000, 3240, formatEuro)).toBe(`${formatEuro(240)} bleiben offen`)
    expect(refundDifference(3250, 3250, formatEuro)).toBe('Passt genau')
  })
  it('zählt nur offene Eltern-Ausgaben, älteste zuerst', () => {
    const list = [...items, entry({ id: 'x', categoryId: PARENTS_EXPENSE, refunded: true }), entry({ id: 'y', categoryId: 'exp-food' })].reverse()
    expect(openItems(list).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('rechnet die Monatsabrechnung mit Übertrag', () => {
    const all = [
      entry({ categoryId: PARENTS_EXPENSE, amount: 5000, date: '2026-09-10' }),
      entry({ type: 'income', categoryId: PARENTS_REFUND, amount: 4760, date: '2026-09-30' }),
      ...items,
      entry({ type: 'income', categoryId: PARENTS_REFUND, amount: 3250, date: '2026-10-25' }),
      entry({ categoryId: PARENTS_EXPENSE, amount: 999, date: '2026-11-02' }),
    ]
    const s = parentsStatement(all, '2026-10')
    expect(s.items.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(s).toMatchObject({ spent: 7000, refunds: 3250, carry: 240, open: 240 + 7000 - 3250 })
  })
})

describe('Verschlüsseltes Backup', () => {
  it('enthält Daten und Fotos und öffnet sich nur mit dem App-Code', async () => {
    const photo = await jpeg(300, 500)
    await savePhotos([{ id: 'p1', data: photo }, { id: 'p2', data: await jpeg(40, 40) }])
    await db.entries.add(entry({ id: 'e1', note: 'Geheimes Abendessen', photos: ['p1', 'p2'] }))
    await setMeta('apiKey', 'sk-ant-geheim')
    const { text, photos } = await createBackupFile()
    expect(photos).toBe(2)
    expect(text).not.toContain('Abendessen')
    expect(text).not.toContain('sk-ant')
    expect(text).not.toContain(CODE)
    const sealed = readSealed(text)!
    await expect(openBackupFile(sealed, 'falscher-code')).rejects.toThrow('App-Code passt nicht')
    const opened = await openBackupFile(sealed, CODE)
    expect(opened.backup.entries[0].note).toBe('Geheimes Abendessen')
    expect(new Uint8Array(await opened.photos[0].data.arrayBuffer())).toEqual(new Uint8Array(await photo.arrayBuffer()))
    expect(JSON.stringify(opened.backup)).not.toContain('sk-ant')
  })
  it('lässt sich auf einem neuen iPhone mit anderem Code wiederherstellen', async () => {
    await savePhotos([{ id: 'p1', data: await jpeg(200, 300) }])
    await db.entries.bulkAdd([entry({ id: 'e1', photos: ['p1'], note: 'Mit Foto' }), entry({ id: 'e2', note: 'Ohne' })])
    await whenSaved()
    const { text } = await createBackupFile()

    // New device: everything gone, a different code
    closeSession()
    await resetDevice()
    await db.delete()
    await db.open()
    await prepareSetup()
    await setupVault('Anderer-Code-9')
    const { backup, photos } = await openBackupFile(readSealed(text)!, CODE)
    await restoreBackup(backup, photos)
    expect((await db.entries.toArray()).map((e) => e.note).sort()).toEqual(['Mit Foto', 'Ohne'])
    expect(await loadPhoto('p1')).not.toBeNull()

    // And it stays after a restart with the new code
    await whenSaved()
    closeSession()
    await db.delete()
    await db.open()
    expect((await unlockWithCode('Anderer-Code-9')).ok).toBe(true)
    expect((await db.entries.get('e1'))?.photos).toEqual(['p1'])
    expect(await loadPhoto('p1')).not.toBeNull()
  })
  it('spielt alte, unverschlüsselte Backups weiter ein und entfernt dabei alte Fotos', async () => {
    await savePhotos([{ id: 'alt', data: await jpeg(10, 10) }])
    await db.entries.add(entry({ photos: ['alt'] }))
    const old = await createBackup()
    old.version = 3
    old.entries = [entry({ note: 'Aus altem Backup' })]
    const text = JSON.stringify(old)
    expect(readSealed(text)).toBeNull()
    await restoreBackup(parseBackup(text))
    expect((await db.entries.toArray()).map((e) => e.note)).toEqual(['Aus altem Backup'])
    expect(await store.photos.count()).toBe(0)
  })
  it('lehnt veränderte Dateien ab', async () => {
    await db.entries.add(entry({}))
    const file = JSON.parse((await createBackupFile()).text)
    file.data = `${file.data.slice(0, 20)}AAAA${file.data.slice(24)}`
    await expect(openBackupFile(readSealed(JSON.stringify(file))!, CODE)).rejects.toThrow('beschädigt')
    expect(() => readSealed(JSON.stringify({ ...file, version: 99 }))).toThrow('neueren')
  })
})

describe('Erinnerungen', () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime()
  it('erinnert am Backup-Tag, bis ein Backup gemacht oder die Erinnerung ausgeblendet ist', () => {
    const s = (now: string, last: string | null, dismissed: string | null = null, d = 1) => backupState(now, last ? day(last) : null, { enabled: true, day: d, dismissed }, day(now))
    expect(s('2026-11-01', '2026-10-15').reminder).toBe(true)
    expect(s('2026-11-01', '2026-11-01').reminder).toBe(false)
    expect(s('2026-11-20', '2026-10-31', '2026-11').reminder).toBe(false)
    expect(s('2026-11-14', '2026-11-02', null, 15).reminder).toBe(false)
    expect(s('2026-11-15', '2026-11-02', null, 15).reminder).toBe(true)
    expect(backupState('2026-11-15', null, { enabled: false, day: 1, dismissed: null }).reminder).toBe(false)
  })
  it('meldet ein Backup, das 30 Tage oder älter ist', () => {
    expect(backupState('2026-11-20', day('2026-10-21'), { enabled: false, day: 1, dismissed: null }, day('2026-11-20')).stale).toBe(true)
    expect(backupState('2026-11-20', day('2026-10-25'), { enabled: false, day: 1, dismissed: null }, day('2026-11-20')).stale).toBe(false)
    expect(backupState('2026-11-20', null, { enabled: false, day: 1, dismissed: null }).stale).toBe(true)
  })
  it('fragt am Monatsende und im Folgemonat nach der Eltern-Abrechnung', () => {
    expect(reportMonth('2026-10-31')).toBe('2026-10')
    expect(reportMonth('2026-11-01')).toBe('2026-10')
    expect(reportMonth('2026-11-15')).toBe('2026-10')
    const parents = [entry({ categoryId: PARENTS_EXPENSE, date: '2026-10-03' })]
    expect(parentsReportDue('2026-11-01', parents, [], true)).toBe('2026-10')
    expect(parentsReportDue('2026-11-01', parents, ['2026-10'], true)).toBeNull()
    expect(parentsReportDue('2026-11-01', parents, [], false)).toBeNull()
    expect(parentsReportDue('2026-12-01', parents, [], true)).toBeNull()
  })
})

describe('PDF', () => {
  const pages = async (blob: Blob) => (new TextDecoder('latin1').decode(await blob.arrayBuffer()).match(/\/Type \/Page\b(?!s)/g) ?? []).length

  it('schreibt nur Zeichen, die die PDF-Schrift kennt', () => {
    expect(pdfText('−12,00 € 🍕 Café „Süd“')).toBe('-12,00 € Café „Süd“')
  })
  it('erstellt die Eltern-Abrechnung mit vielen Fotos, eines pro Seite', async () => {
    const list: Entry[] = []
    for (let i = 0; i < 40; i++) {
      const id = `p${i}`
      await savePhotos([{ id, data: await jpeg(1200, 1800, { r: 200 + (i % 50), g: 220, b: 210 }) }])
      list.push(entry({ categoryId: PARENTS_EXPENSE, date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, amount: 1000 + i, photos: [id], note: `Einkauf ${i} für Mama 🛒` }))
    }
    const blob = await parentsReport(parentsStatement(list, '2026-10'), { name: 'Max Muster', created: '08.11.2026' })
    const head = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))
    expect(head).toBe('%PDF-')
    // Two pages for 40 rows and the sums, then 40 photo pages
    expect(await pages(blob)).toBe(42)
  }, 60_000)
  it('erstellt den Monatsbericht, mit und ohne Fotos', async () => {
    await savePhotos([{ id: 'p', data: await jpeg() }])
    const list = [entry({ photos: ['p'] }), entry({ type: 'income', categoryId: 'inc-income', amount: 200000 }), entry({ type: 'saving', categoryId: 'sav-investitionen', amount: 30000 })]
    const categories = await db.categories.toArray()
    const groups = await db.groups.toArray()
    const options = { name: '', created: '08.11.2026', hiddenParents: false }
    expect(await pages(await monthReport('2026-10', list, categories, groups, { ...options, photos: false }))).toBe(1)
    expect(await pages(await monthReport('2026-10', list, categories, groups, { ...options, photos: true }))).toBe(2)
  })
})
