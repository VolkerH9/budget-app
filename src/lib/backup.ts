import { db, getMeta, setMeta, type Category, type Entry, type Goal, type Group, type Label, type PeriodBudget, type Recurring } from '../db'
import { isValidIso, today } from './dates'
import { expectSystemDialog } from './lockGuard'
import { DATA_VERSION, migrateData } from './migrate'
import { loadPhoto, prunePhotos, savePhotos, seal, unseal, whenSaved, type Bytes } from './vault'

interface Settings {
  savingsGoal: number | null
  saveThumbnails: boolean
  hideParents?: boolean
  reminderDays?: number
}

/** Where a photo lies in the encrypted part of a backup file */
interface PhotoRef {
  id: string
  offset: number
  length: number
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
  photos?: PhotoRef[]
  /** Since version 5 */
  labels?: Label[]
  /** Since version 6 */
  budgets?: PeriodBudget[]
  goals?: Goal[]
}

/** A backup file since version 4: everything inside `data` is encrypted, photos included. */
interface SealedFile {
  app: 'budget'
  encrypted: true
  version: number
  exportedAt: string
  salt: string
  iterations: number
  byCode: { iv: string; key: string }
  iv: string
  data: string
}

export interface Photo {
  id: string
  data: Blob
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
    labels: await db.labels.toArray(),
    budgets: await db.budgets.toArray(),
    goals: await db.goals.toArray(),
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

// Base64 in pieces, a whole backup with photos is too long for one call
function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

function fromBase64(text: string): Bytes {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()

/**
 * The backup file: data and photos, encrypted so that only the current access code
 * opens it. API key and access code are not inside.
 */
export async function createBackupFile(): Promise<{ text: string; photos: number }> {
  const backup = await createBackup()
  const parts: Uint8Array[] = []
  const refs: PhotoRef[] = []
  let offset = 0
  for (const id of new Set(backup.entries.flatMap((e) => e.photos ?? []))) {
    const photo = await loadPhoto(id)
    if (!photo) continue
    const bytes = new Uint8Array(await photo.arrayBuffer())
    parts.push(bytes)
    refs.push({ id, offset, length: bytes.length })
    offset += bytes.length
  }
  const stored = new Set(refs.map((r) => r.id))
  backup.entries = backup.entries.map((e) => (e.photos ? { ...e, photos: e.photos.filter((id) => stored.has(id)) } : e))
  backup.photos = refs

  // Layout: length of the JSON (4 bytes), the JSON, then the photos one after the other
  const json = encoder.encode(JSON.stringify(backup))
  const plain = new Uint8Array(4 + json.length + offset)
  new DataView(plain.buffer).setUint32(0, json.length)
  plain.set(json, 4)
  for (const [i, ref] of refs.entries()) plain.set(parts[i], 4 + json.length + ref.offset)

  const sealed = await seal(plain)
  const file: SealedFile = {
    app: 'budget',
    encrypted: true,
    version: DATA_VERSION,
    exportedAt: backup.exportedAt,
    salt: toBase64(sealed.salt),
    iterations: sealed.iterations,
    byCode: { iv: toBase64(sealed.byCode.iv), key: toBase64(new Uint8Array(sealed.byCode.key)) },
    iv: toBase64(sealed.iv),
    data: toBase64(new Uint8Array(sealed.data)),
  }
  return { text: JSON.stringify(file), photos: refs.length }
}

/** The encrypted file, null for a file of an older version without encryption. */
export function readSealed(text: string): SealedFile | null {
  let file: SealedFile
  try {
    file = JSON.parse(text)
  } catch {
    throw new Error('Diese Datei ist kein gültiges Backup.')
  }
  if (file?.app !== 'budget') throw new Error('Diese Datei ist kein Backup dieser App.')
  if (file.encrypted !== true) return null
  if (file.version > DATA_VERSION) throw new Error('Dieses Backup stammt aus einer neueren App-Version.')
  if (typeof file.data !== 'string' || typeof file.salt !== 'string' || typeof file.iv !== 'string' || typeof file.byCode?.key !== 'string' || !Number.isInteger(file.iterations)) {
    throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  }
  return file
}

/** Decrypts with the access code that was valid when the backup was made. */
export async function openBackupFile(file: SealedFile, code: string): Promise<{ backup: Backup; photos: Photo[] }> {
  let plain: Bytes
  try {
    const sealed = {
      salt: fromBase64(file.salt),
      iterations: file.iterations,
      byCode: { iv: fromBase64(file.byCode.iv), key: fromBase64(file.byCode.key).buffer },
      iv: fromBase64(file.iv),
      data: fromBase64(file.data).buffer,
    }
    plain = new Uint8Array(await unseal(sealed, code))
  } catch (error) {
    if ((error as Error).message.includes('App-Code')) throw error
    throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  }
  const length = new DataView(plain.buffer).getUint32(0)
  const backup = parseBackup(new TextDecoder().decode(plain.subarray(4, 4 + length)))
  const start = 4 + length
  const photos = (backup.photos ?? []).map((ref) => {
    if (!Number.isSafeInteger(ref.offset) || !Number.isSafeInteger(ref.length) || start + ref.offset + ref.length > plain.length) {
      throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
    }
    return { id: ref.id, data: new Blob([plain.slice(start + ref.offset, start + ref.offset + ref.length)], { type: 'image/jpeg' }) }
  })
  return { backup, photos }
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
  if (data.labels !== undefined && (!Array.isArray(data.labels) || !data.labels.every((l) => typeof l?.id === 'string' && typeof l.name === 'string'))) {
    throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  }
  const listOk = (list: unknown) => list === undefined || (Array.isArray(list) && list.every((x) => typeof x?.id === 'string'))
  if (!listOk(data.budgets) || !listOk(data.goals)) throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  const labelsOk = (e: Entry) => e.labels === undefined || (Array.isArray(e.labels) && e.labels.every((id) => typeof id === 'string'))
  const photosOk = (e: Entry) => e.photos === undefined || (Array.isArray(e.photos) && e.photos.every((id) => typeof id === 'string'))
  const entriesOk = data.entries.every((e) => typeof e.id === 'string' && isType(e.type) && isCents(e.amount) && isValidIso(e.date) && categoryIds.has(e.categoryId) && photosOk(e) && labelsOk(e))
  // Abos without an amount yet are allowed
  const recurringOk = data.recurring.every((r) => typeof r.id === 'string' && isType(r.type) && (isCents(r.amount) || (!!r.subscription && r.amount === 0)) && isValidIso(r.startDate) && isValidIso(r.nextDue) && categoryIds.has(r.categoryId))
  if (!categoriesOk || !entriesOk || !recurringOk) throw new Error('Das Backup ist beschädigt und wurde nicht eingespielt.')
  return data
}

/** Replaces all entries, categories, overcategories, standing orders, Abos, labels and photos. Older files are migrated. */
export async function restoreBackup(backup: Backup, photos: Photo[] = []): Promise<void> {
  // Photos first, so no restored entry points to a missing photo
  await savePhotos(photos)
  const data = migrateData({ categories: backup.categories, groups: backup.groups ?? [], entries: backup.entries, recurring: backup.recurring, meta: [], labels: backup.labels ?? [], budgets: backup.budgets ?? [], goals: backup.goals ?? [] }, backup.version)
  await db.transaction('rw', [db.categories, db.groups, db.entries, db.recurring, db.meta, db.labels, db.budgets, db.goals], async () => {
    await Promise.all([db.categories.clear(), db.groups.clear(), db.entries.clear(), db.recurring.clear(), db.labels.clear(), db.budgets.clear(), db.goals.clear()])
    await db.labels.bulkAdd(data.labels)
    await db.budgets.bulkAdd(data.budgets)
    await db.goals.bulkAdd(data.goals)
    await db.groups.bulkAdd(data.groups)
    await db.categories.bulkAdd(data.categories)
    await db.entries.bulkAdd(data.entries)
    await db.recurring.bulkAdd(data.recurring)
    await setMeta('savingsGoal', backup.settings?.savingsGoal ?? null)
    await setMeta('saveThumbnails', backup.settings?.saveThumbnails ?? true)
    await setMeta('hideParents', backup.settings?.hideParents ?? false)
    await setMeta('reminderDays', backup.settings?.reminderDays ?? 7)
  })
  // Photos of the replaced entries go once the new state is stored
  await whenSaved()
  await prunePhotos(await db.entries.toArray())
}

const LABELS = { expense: 'Ausgabe', saving: 'Sparen', income: 'Einnahme' }

function cell(value: string): string {
  // A leading = or + would run as a formula in Excel
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(entries: Entry[], categories: Category[], groups: Group[] = [], labels: Label[] = []): string {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const labelNames = new Map(labels.map((l) => [l.id, l.name]))
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
    (e.labels ?? []).map((id) => labelNames.get(id)).filter(Boolean).join(', '),
  ].map(cell).join(';'))
  // The byte order mark tells Excel the file is UTF-8; semicolons fit the German setup
  return `﻿${['Datum;Art;Überkategorie;Kategorie;Betrag;Händler;Notiz;Dauerauftrag;Labels', ...rows].join('\r\n')}\r\n`
}

export type AskToShare = (share: () => void, cancel: () => void) => void

/**
 * Opens the iPhone share sheet, falls back to a plain download on desktop.
 * When preparing the file took long, iOS only opens the sheet after another tap:
 * `askToShare` then shows a button that shares on that tap. Resolves to false when cancelled.
 */
export async function saveFile(name: string, content: BlobPart, type: string, askToShare?: AskToShare): Promise<boolean> {
  const file = new File([content], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    expectSystemDialog()
    try {
      await navigator.share({ files: [file], title: name })
      return true
    } catch (error) {
      if ((error as Error).name === 'AbortError') return false
      if ((error as Error).name !== 'NotAllowedError') throw error
      if (askToShare) {
        return new Promise<boolean>((resolve) => askToShare(() => {
          expectSystemDialog()
          navigator.share({ files: [file], title: name }).then(() => resolve(true), () => resolve(false))
        }, () => resolve(false)))
      }
      // Share sheet not allowed here: save as a download instead
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

export const backupName = (extension: string) => `budget-backup-${today()}.${extension}`
