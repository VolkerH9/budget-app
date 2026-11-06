import Dexie, { type DBCoreMutateRequest, type DBCoreMutateResponse, type Table } from 'dexie'
import { db, TABLES, type Category, type Entry, type Meta, type Recurring, type TableName } from '../db'
import { DATA_VERSION, freshData, migrateData, splitFoodCategory, type DataSet } from './migrate'

/**
 * Everything the app stores on the device goes through this file.
 *
 * A random data key encrypts every record with AES-GCM. The data key itself is
 * only stored wrapped: always with a key derived from the access code (PBKDF2),
 * and, while this device is signed in, once more for opening without the code:
 * with a secret that only Face ID releases (WebAuthn PRF) where the iPhone offers
 * one, otherwise with a device key the browser keeps and never hands out.
 */

interface VaultRow {
  /** `${table}/${primary key}` */
  k: string
  t: TableName
  iv: Bytes
  d: ArrayBuffer
}

type Bytes = Uint8Array<ArrayBuffer>

interface Wrapped {
  iv: Bytes
  key: ArrayBuffer
}

export interface Keyring {
  id: 'main'
  salt: Bytes
  iterations: number
  byCode: Wrapped
  /** Signed in without a Face ID secret: the data key, wrapped with a key that cannot be exported */
  device?: { key: CryptoKey; wrapped: Wrapped }
  /** Face ID before opening. With `wrapped`, only the Face ID secret releases the data key. */
  faceId?: { credentialId: string; prfSalt?: Bytes; wrapped?: Wrapped }
  failures: number
  blockedUntil: number
  /** Seconds in the background before the app locks, 0 = right away, null = never */
  lockAfter: number | null
  /** 2 since the sign-in on the device */
  version?: number
}

export const isSignedIn = (ring: Keyring) => !!ring.device || !!ring.faceId?.wrapped

/** Settings and PIN of the version without encryption */
export interface LegacyLock {
  salt: string
  pinHash: string
  credentialId?: string
}

/** The database on the device. Its name and first versions are those of the unencrypted app. */
export const store = new Dexie('budget') as Dexie & {
  categories: Table<Category, string>
  entries: Table<Entry, string>
  recurring: Table<Recurring, string>
  meta: Table<Meta, string>
  vault: Table<VaultRow, string>
  keyring: Table<Keyring, string>
}

store.version(1).stores({
  categories: 'id, type, order',
  entries: 'id, date, [type+date], categoryId, recurringId, &recurringKey',
  recurring: 'id, categoryId',
  meta: 'key',
})

store.version(2).upgrade(async (tx) => {
  const table = tx.table<Category, string>('categories')
  await table.bulkPut(splitFoodCategory(await table.toArray()))
})

store.version(3).stores({ vault: 'k, t', keyring: 'id' })

export const ITERATIONS = 600_000
export const MIN_CODE_LENGTH = 6

const text = new TextEncoder()
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length))

async function codeKey(code: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', text.encode(code.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
}

async function faceIdKey(secret: BufferSource): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: text.encode('budget-face-id') },
    base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'],
  )
}

async function wrap(key: CryptoKey, by: CryptoKey): Promise<Wrapped> {
  const iv = random(12)
  return { iv, key: await crypto.subtle.wrapKey('raw', key, by, { name: 'AES-GCM', iv }) }
}

/** Throws when the code or the Face ID secret is wrong. */
const unwrap = (wrapped: Wrapped, by: CryptoKey) => crypto.subtle.unwrapKey(
  'raw', wrapped.key, by, { name: 'AES-GCM', iv: wrapped.iv }, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'],
)

async function encryptRow(key: CryptoKey, t: TableName, id: string, value: unknown): Promise<VaultRow> {
  const k = `${t}/${id}`
  const iv = random(12)
  // The record's address is authenticated too, so records cannot be swapped
  const d = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(k) }, key, text.encode(JSON.stringify(value)))
  return { k, t, iv, d }
}

async function decryptRow(key: CryptoKey, row: VaultRow): Promise<unknown> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: text.encode(row.k) }, key, row.d)
  return JSON.parse(new TextDecoder().decode(plain))
}

const primaryKey = (t: TableName, value: unknown) => String((value as Record<string, unknown>)[t === 'meta' ? 'key' : 'id'])

// ---- Keeping the device copy in step with the app ----

let dataKey: CryptoKey | null = null
let tracking = false
let openWrites = 0
const pending = new Map<string, { t: TableName; id: string; value: unknown | null }>()
const resync = new Set<TableName>()
let queue = Promise.resolve()

/** Called when a change could not be written to the device. */
export const saving = { onError: (error: unknown) => console.error(error) }

function track(t: TableName, req: DBCoreMutateRequest, res: DBCoreMutateResponse) {
  const failed = (i: number) => !!res.failures?.[i]
  if (req.type === 'add' || req.type === 'put') {
    req.values.forEach((value, i) => {
      if (!failed(i)) pending.set(`${t}/${primaryKey(t, value)}`, { t, id: primaryKey(t, value), value })
    })
  } else if (req.type === 'delete') {
    req.keys.forEach((key, i) => { if (!failed(i)) pending.set(`${t}/${key}`, { t, id: String(key), value: null }) })
  } else {
    resync.add(t)
  }
}

db.use({
  stack: 'dbcore',
  name: 'vault',
  create: (down) => ({
    ...down,
    table: (name) => {
      const table = down.table(name)
      return {
        ...table,
        mutate: async (req) => {
          if (!tracking) return table.mutate(req)
          openWrites++
          const trans = req.trans as unknown as IDBTransaction
          let done = false
          const finish = (committed: boolean, res?: DBCoreMutateResponse) => {
            if (done) return
            done = true
            openWrites--
            if (committed && res) track(name as TableName, req, res)
            scheduleFlush()
          }
          try {
            const res = await table.mutate(req)
            // Only changes of a transaction that went through reach the device
            if (typeof trans?.addEventListener === 'function') {
              trans.addEventListener('complete', () => finish(true, res))
              trans.addEventListener('abort', () => finish(false))
              trans.addEventListener('error', () => finish(false))
            } else {
              finish(true, res)
            }
            return res
          } catch (error) {
            finish(false)
            throw error
          }
        },
      }
    },
  }),
})

function scheduleFlush() {
  queue = queue.then(flush).catch((error) => saving.onError(error))
}

async function flush() {
  const key = dataKey
  if (!key || (pending.size === 0 && resync.size === 0)) return
  const tables = [...resync]
  resync.clear()
  // A table written in full already contains the newest state of its records
  const changes = [...pending.values()].filter((c) => !tables.includes(c.t))
  pending.clear()

  const puts: VaultRow[] = []
  const deletes: string[] = []
  const full = new Map<TableName, Set<string>>()
  for (const t of tables) {
    const rows = await db.table(t).toArray()
    full.set(t, new Set<string>(rows.map((row) => `${t}/${primaryKey(t, row)}`)))
    for (const row of rows) puts.push(await encryptRow(key, t, primaryKey(t, row), row))
  }
  for (const c of changes) {
    if (c.value === null) deletes.push(`${c.t}/${c.id}`)
    else puts.push(await encryptRow(key, c.t, c.id, c.value))
  }
  await store.transaction('rw', store.vault, async () => {
    for (const [t, keep] of full) {
      const stale = (await store.vault.where('t').equals(t).primaryKeys()).filter((k) => !keep.has(k))
      await store.vault.bulkDelete(stale)
    }
    await store.vault.bulkDelete(deletes)
    await store.vault.bulkPut(puts)
  })
}

/** Resolves once every change made so far is stored encrypted on the device. */
export async function whenSaved(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await queue
    if (openWrites === 0 && pending.size === 0 && resync.size === 0) return
  }
}

// ---- Loading ----

export type StartState = { kind: 'fresh' } | { kind: 'legacy'; lock: LegacyLock | null } | { kind: 'locked'; keyring: Keyring }

/** Keyrings from before the sign-in on the device: Face ID stays, the time lock goes off. */
async function upgradeKeyring(ring: Keyring): Promise<Keyring> {
  if ((ring.version ?? 1) >= 2) return ring
  const next: Keyring = { ...ring, lockAfter: null, version: 2 }
  await store.keyring.put(next)
  return next
}

export async function startState(): Promise<StartState> {
  const keyring = await store.keyring.get('main')
  if (keyring) return { kind: 'locked', keyring: await upgradeKeyring(keyring) }
  const legacy = (await store.categories.count()) > 0 || (await store.entries.count()) > 0
  if (!legacy) return { kind: 'fresh' }
  const lock = await store.meta.get('lock')
  return { kind: 'legacy', lock: (lock?.value as LegacyLock | undefined) ?? null }
}

/** Unencrypted data of the previous version. The old PIN stays behind. */
export async function readLegacy(): Promise<DataSet> {
  return {
    categories: await store.categories.toArray(),
    groups: [],
    entries: await store.entries.toArray(),
    recurring: await store.recurring.toArray(),
    meta: (await store.meta.toArray()).filter((m) => m.key !== 'lock'),
  }
}

async function fill(data: DataSet) {
  const wasTracking = tracking
  tracking = false
  try {
    await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
      for (const t of TABLES) {
        await db.table(t).clear()
        await db.table(t).bulkAdd(data[t] as never[])
      }
    })
  } finally {
    tracking = wasTracking
  }
}

async function snapshot(): Promise<DataSet> {
  const entries = await Promise.all(TABLES.map(async (t) => [t, await db.table(t).toArray()] as const))
  return Object.fromEntries(entries) as unknown as DataSet
}

const withVersion = (data: DataSet): DataSet => ({
  ...data,
  meta: [...data.meta.filter((m) => m.key !== 'dataVersion'), { key: 'dataVersion', value: DATA_VERSION }],
})

/**
 * Puts the data that is about to be encrypted into the app.
 * Old data gets migrated; a copy of it as it was stays in the app as a backup.
 */
export async function prepareSetup(): Promise<{ entries: number; recurring: number; legacy: boolean }> {
  const state = await startState()
  if (state.kind === 'locked') throw new Error('Der App-Code ist bereits eingerichtet.')
  let data: DataSet
  if (state.kind === 'legacy') {
    const legacy = await readLegacy()
    const before = { app: 'budget', version: 1, exportedAt: new Date().toISOString(), categories: legacy.categories, entries: legacy.entries, recurring: legacy.recurring, settings: settingsOf(legacy.meta) }
    data = migrateData(legacy, 2)
    data.meta.push({ key: 'preUpdateBackup', value: before })
  } else {
    data = freshData()
  }
  await fill(withVersion(data))
  return { entries: data.entries.length, recurring: data.recurring.filter((r) => !r.subscription).length, legacy: state.kind === 'legacy' }
}

function settingsOf(meta: Meta[]) {
  const get = (key: string, fallback: unknown) => meta.find((m) => m.key === key)?.value ?? fallback
  return { savingsGoal: get('savingsGoal', null) as number | null, saveThumbnails: get('saveThumbnails', true) as boolean }
}

/**
 * Encrypts what is in the app with a new access code, checks the stored copy
 * record by record, and only then removes the unencrypted data of the old version.
 */
export async function setupVault(code: string): Promise<{ checked: number }> {
  if (code.length < MIN_CODE_LENGTH) throw new Error(`Der Code braucht mindestens ${MIN_CODE_LENGTH} Zeichen.`)
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const salt = random(16)
  const keyring: Keyring = {
    id: 'main', salt, iterations: ITERATIONS, byCode: await wrap(key, await codeKey(code, salt, ITERATIONS)),
    failures: 0, blockedUntil: 0, lockAfter: null, version: 2,
  }
  const data = await snapshot()
  const rows: VaultRow[] = []
  for (const t of TABLES) for (const value of data[t]) rows.push(await encryptRow(key, t, primaryKey(t, value), value))

  await store.transaction('rw', store.vault, async () => {
    await store.vault.clear()
    await store.vault.bulkAdd(rows)
  })

  // Read back from the device and compare with the data in the app
  const stored = await store.vault.toArray()
  const expected = new Map<string, string>(TABLES.flatMap((t) => data[t].map((value) => [`${t}/${primaryKey(t, value)}`, JSON.stringify(value)] as const)))
  let checked = 0
  for (const row of stored) {
    if (expected.get(row.k) !== JSON.stringify(await decryptRow(key, row))) break
    checked++
  }
  if (checked !== expected.size || stored.length !== expected.size) {
    await store.vault.clear()
    throw new Error('Die Prüfung der verschlüsselten Daten ist fehlgeschlagen. Es wurde nichts verändert.')
  }

  await store.transaction('rw', [store.keyring, store.categories, store.entries, store.recurring, store.meta], async () => {
    await store.keyring.put(keyring)
    await Promise.all([store.categories.clear(), store.entries.clear(), store.recurring.clear(), store.meta.clear()])
  })
  dataKey = key
  tracking = true
  return { checked }
}

async function open(key: CryptoKey) {
  const rows = await store.vault.toArray()
  const data: DataSet = { categories: [], groups: [], entries: [], recurring: [], meta: [] }
  for (const row of rows) (data[row.t] as unknown[]).push(await decryptRow(key, row))
  const version = (data.meta.find((m) => m.key === 'dataVersion')?.value as number | undefined) ?? DATA_VERSION
  const migrated = version < DATA_VERSION
  await fill(migrated ? withVersion(migrateData(data, version)) : data)
  dataKey = key
  tracking = true
  if (migrated) {
    TABLES.forEach((t) => resync.add(t))
    scheduleFlush()
  }
}

export const isOpen = () => dataKey !== null

/** Waiting time after a number of wrong codes in a row */
export function waitAfter(failures: number): number {
  const steps = [0, 0, 0, 0, 0, 30, 60, 300, 900]
  return (failures < steps.length ? steps[failures] : 3600) * 1000
}

export type UnlockResult = { ok: true } | { ok: false; blockedUntil: number }

/** Checks the code and, on the first unlock after starting, loads the data. */
export async function unlockWithCode(code: string): Promise<UnlockResult> {
  const keyring = (await store.keyring.get('main'))!
  if (Date.now() < keyring.blockedUntil) return { ok: false, blockedUntil: keyring.blockedUntil }
  let key: CryptoKey
  try {
    key = await unwrap(keyring.byCode, await codeKey(code, keyring.salt, keyring.iterations))
  } catch {
    const failures = keyring.failures + 1
    const wait = waitAfter(failures)
    const blockedUntil = wait > 0 ? Date.now() + wait : 0
    await store.keyring.update('main', { failures, blockedUntil })
    return { ok: false, blockedUntil }
  }
  if (keyring.failures > 0) await store.keyring.update('main', { failures: 0, blockedUntil: 0 })
  if (!dataKey) await open(key)
  return { ok: true }
}

/**
 * Opens on a signed-in device. Face ID, if switched on, was confirmed before;
 * `secret` is what it released, needed when the data key is bound to it.
 */
export async function unlockOnDevice(secret: BufferSource | null): Promise<void> {
  const keyring = (await store.keyring.get('main'))!
  let key: CryptoKey
  if (keyring.faceId?.wrapped) {
    if (!secret) throw new Error('Face ID hat kein Geheimnis geliefert.')
    key = await unwrap(keyring.faceId.wrapped, await faceIdKey(secret))
  } else if (keyring.device) {
    key = await unwrap(keyring.device.wrapped, keyring.device.key)
  } else {
    throw new Error('Dieses Gerät ist abgemeldet.')
  }
  if (keyring.failures > 0) await store.keyring.update('main', { failures: 0, blockedUntil: 0 })
  if (!dataKey) await open(key)
}

export interface FaceIdSetup {
  credentialId: string
  prfSalt: Bytes
  /** null when the iPhone confirms Face ID but releases no secret */
  secret: BufferSource | null
}

/**
 * Keeps this device signed in, so the app opens without the access code.
 * With Face ID the app asks for it first; with its secret the data key is bound to it.
 */
export async function signIn(face: FaceIdSetup | null): Promise<void> {
  if (!dataKey) throw new Error('Die App ist gesperrt.')
  if (face?.secret) {
    const wrapped = await wrap(dataKey, await faceIdKey(face.secret))
    await store.keyring.update('main', { device: undefined, faceId: { credentialId: face.credentialId, prfSalt: face.prfSalt, wrapped } })
    return
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey'])
  await store.keyring.update('main', {
    device: { key, wrapped: await wrap(dataKey, key) },
    faceId: face ? { credentialId: face.credentialId } : undefined,
  })
}

/** After this only the access code opens the app on this device. */
export const signOut = () => store.keyring.update('main', { device: undefined, faceId: undefined })

export const getKeyring = () => store.keyring.get('main')

export const setLockAfter = (seconds: number | null) => store.keyring.update('main', { lockAfter: seconds })

/** Checks the code without counting a mistake, for confirmations inside the unlocked app. */
export async function checkCode(code: string): Promise<boolean> {
  const keyring = (await store.keyring.get('main'))!
  try {
    await unwrap(keyring.byCode, await codeKey(code, keyring.salt, keyring.iterations))
    return true
  } catch {
    return false
  }
}

/**
 * Sets a new code while the app is unlocked, so a forgotten code can be replaced.
 * The data stays as it is; only the wrapping of the data key changes.
 */
export async function changeCode(newCode: string): Promise<void> {
  if (newCode.length < MIN_CODE_LENGTH) throw new Error(`Der Code braucht mindestens ${MIN_CODE_LENGTH} Zeichen.`)
  if (!dataKey) throw new Error('Die App ist gesperrt.')
  const salt = random(16)
  await store.keyring.update('main', { salt, iterations: ITERATIONS, byCode: await wrap(dataKey, await codeKey(newCode, salt, ITERATIONS)), failures: 0, blockedUntil: 0 })
}

/** Forgets the key, as when the app is closed. The data on the device stays. */
export function closeSession(): void {
  dataKey = null
  tracking = false
}

/** Deletes everything on this device, including the encrypted data. */
export async function resetDevice(): Promise<void> {
  dataKey = null
  tracking = false
  await store.delete({ disableAutoOpen: false })
}
