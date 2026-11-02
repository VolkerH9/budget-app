import { db, getMeta, setMeta, type Category, type Entry, type Recurring } from '../db'
import { isValidIso, today } from './dates'
import { expectSystemDialog } from './lockGuard'

export interface Backup {
  app: 'budget'
  version: 1
  exportedAt: string
  categories: Category[]
  entries: Entry[]
  recurring: Recurring[]
  settings: { savingsGoal: number | null; saveThumbnails: boolean }
}

/** API key and lock data stay out of the file on purpose: it may end up in iCloud Drive or a chat. */
export async function createBackup(): Promise<Backup> {
  return {
    app: 'budget',
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: await db.categories.orderBy('order').toArray(),
    entries: await db.entries.orderBy('date').toArray(),
    recurring: await db.recurring.toArray(),
    settings: {
      savingsGoal: await getMeta<number | null>('savingsGoal', null),
      saveThumbnails: await getMeta('saveThumbnails', true),
    },
  }
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
  if (data.version !== 1) throw new Error('Dieses Backup stammt aus einer neueren App-Version.')
  const categoryIds = new Set(data.categories.map((c) => c?.id))
  const categoriesOk = data.categories.every((c) => typeof c.id === 'string' && typeof c.name === 'string' && isType(c.type))
  const entriesOk = data.entries.every((e) => typeof e.id === 'string' && isType(e.type) && isCents(e.amount) && isValidIso(e.date) && categoryIds.has(e.categoryId))
  const recurringOk = data.recurring.every((r) => typeof r.id === 'string' && isType(r.type) && isCents(r.amount) && isValidIso(r.startDate) && isValidIso(r.nextDue) && categoryIds.has(r.categoryId))
  if (!categoriesOk || !entriesOk || !recurringOk) throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  return data
}

/** Replaces all entries, categories and standing orders. */
export async function restoreBackup(backup: Backup): Promise<void> {
  await db.transaction('rw', db.categories, db.entries, db.recurring, db.meta, async () => {
    await Promise.all([db.categories.clear(), db.entries.clear(), db.recurring.clear()])
    await db.categories.bulkAdd(backup.categories)
    await db.entries.bulkAdd(backup.entries)
    await db.recurring.bulkAdd(backup.recurring)
    await setMeta('savingsGoal', backup.settings?.savingsGoal ?? null)
    await setMeta('saveThumbnails', backup.settings?.saveThumbnails ?? true)
  })
}

const LABELS = { expense: 'Ausgabe', saving: 'Sparen', income: 'Einnahme' }

function cell(value: string): string {
  // A leading = or + would run as a formula in Excel
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(entries: Entry[], categories: Category[]): string {
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const rows = entries.map((e) => [
    e.date.split('-').reverse().join('.'),
    LABELS[e.type],
    names.get(e.categoryId) ?? '',
    (e.amount / 100).toFixed(2).replace('.', ','),
    e.merchant ?? '',
    e.note ?? '',
    e.recurringId ? 'ja' : 'nein',
  ].map(cell).join(';'))
  // The byte order mark tells Excel the file is UTF-8; semicolons fit the German setup
  return `﻿${['Datum;Art;Kategorie;Betrag;Händler;Notiz;Dauerauftrag', ...rows].join('\r\n')}\r\n`
}

/** Opens the iPhone share sheet, falls back to a plain download on desktop. */
export async function saveFile(name: string, content: string, type: string): Promise<void> {
  const file = new File([content], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    expectSystemDialog()
    try {
      await navigator.share({ files: [file], title: name })
    } catch (error) {
      if ((error as Error).name !== 'AbortError') throw error
    }
    return
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export const backupName = (extension: string) => `budget-backup-${today()}.${extension}`
