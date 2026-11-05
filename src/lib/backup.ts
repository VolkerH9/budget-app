import { db, getMeta, setMeta, type Category, type Entry, type Group, type Recurring } from '../db'
import { isValidIso, today } from './dates'
import { expectSystemDialog } from './lockGuard'
import { DATA_VERSION, migrateData } from './migrate'

interface Settings {
  savingsGoal: number | null
  saveThumbnails: boolean
  hideParents?: boolean
  reminderDays?: number
}

export interface Backup {
  app: 'budget'
  /** Layout of the data. Files of the first app version say 1. */
  version: number
  exportedAt: string
  categories: Category[]
  groups?: Group[]
  entries: Entry[]
  recurring: Recurring[]
  settings: Settings
}

/** API key and access code stay out of the file on purpose: it may end up in iCloud Drive or a chat. */
export async function createBackup(): Promise<Backup> {
  return {
    app: 'budget',
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    categories: await db.categories.orderBy('order').toArray(),
    groups: await db.groups.orderBy('order').toArray(),
    entries: await db.entries.orderBy('date').toArray(),
    recurring: await db.recurring.toArray(),
    settings: {
      savingsGoal: await getMeta<number | null>('savingsGoal', null),
      saveThumbnails: await getMeta('saveThumbnails', true),
      hideParents: await getMeta('hideParents', false),
      reminderDays: await getMeta('reminderDays', 7),
    },
  }
}

export async function markBackupDone(): Promise<void> {
  await setMeta('lastBackupAt', Date.now())
}

const isType = (v: unknown) => v === 'expense' || v === 'saving' || v === 'income'
const isCents = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0

export function parseBackup(text: string): Backup {
  let data: Backup
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Diese Datei ist kein gültiges Backup.')
  }
  if (data?.app !== 'budget' || !Array.isArray(data.categories) || !Array.isArray(data.entries) || !Array.isArray(data.recurring)) {
    throw new Error('Diese Datei ist kein Backup dieser App.')
  }
  if (!Number.isInteger(data.version) || data.version < 1) throw new Error('Diese Datei ist kein Backup dieser App.')
  if (data.version > DATA_VERSION) throw new Error('Dieses Backup stammt aus einer neueren App-Version.')
  if (data.groups !== undefined && (!Array.isArray(data.groups) || !data.groups.every((g) => typeof g?.id === 'string' && typeof g.name === 'string' && isType(g.type)))) {
    throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  }
  const categoryIds = new Set(data.categories.map((c) => c?.id))
  const categoriesOk = data.categories.every((c) => typeof c.id === 'string' && typeof c.name === 'string' && isType(c.type))
  const entriesOk = data.entries.every((e) => typeof e.id === 'string' && isType(e.type) && isCents(e.amount) && isValidIso(e.date) && categoryIds.has(e.categoryId))
  // Abos without an amount yet are allowed
  const recurringOk = data.recurring.every((r) => typeof r.id === 'string' && isType(r.type) && (isCents(r.amount) || (!!r.subscription && r.amount === 0)) && isValidIso(r.startDate) && isValidIso(r.nextDue) && categoryIds.has(r.categoryId))
  if (!categoriesOk || !entriesOk || !recurringOk) throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  return data
}

/** Replaces all entries, categories, overcategories, standing orders and Abos. Older files are migrated. */
export async function restoreBackup(backup: Backup): Promise<void> {
  const data = migrateData({ categories: backup.categories, groups: backup.groups ?? [], entries: backup.entries, recurring: backup.recurring, meta: [] }, backup.version)
  await db.transaction('rw', db.categories, db.groups, db.entries, db.recurring, db.meta, async () => {
    await Promise.all([db.categories.clear(), db.groups.clear(), db.entries.clear(), db.recurring.clear()])
    await db.groups.bulkAdd(data.groups)
    await db.categories.bulkAdd(data.categories)
    await db.entries.bulkAdd(data.entries)
    await db.recurring.bulkAdd(data.recurring)
    await setMeta('savingsGoal', backup.settings?.savingsGoal ?? null)
    await setMeta('saveThumbnails', backup.settings?.saveThumbnails ?? true)
    await setMeta('hideParents', backup.settings?.hideParents ?? false)
    await setMeta('reminderDays', backup.settings?.reminderDays ?? 7)
  })
}

const LABELS = { expense: 'Ausgabe', saving: 'Sparen', income: 'Einnahme' }

function cell(value: string): string {
  // A leading = or + would run as a formula in Excel
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(entries: Entry[], categories: Category[], groups: Group[] = []): string {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const groupNames = new Map(groups.map((g) => [g.id, g.name]))
  const rows = entries.map((e) => [
    e.date.split('-').reverse().join('.'),
    LABELS[e.type],
    groupNames.get(byId.get(e.categoryId)?.groupId ?? '') ?? '',
    byId.get(e.categoryId)?.name ?? '',
    (e.amount / 100).toFixed(2).replace('.', ','),
    e.merchant ?? '',
    e.note ?? '',
    e.recurringId ? 'ja' : 'nein',
  ].map(cell).join(';'))
  // The byte order mark tells Excel the file is UTF-8; semicolons fit the German setup
  return `﻿${['Datum;Art;Überkategorie;Kategorie;Betrag;Händler;Notiz;Dauerauftrag', ...rows].join('\r\n')}\r\n`
}

/** Opens the iPhone share sheet, falls back to a plain download on desktop. */
export async function saveFile(name: string, content: string, type: string): Promise<void> {
  const file = new File([content], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    expectSystemDialog()
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      // Share sheet not allowed here: save as a download instead
      if ((error as Error).name !== 'NotAllowedError') throw error
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export const backupName = (extension: string) => `budget-backup-${today()}.${extension}`
