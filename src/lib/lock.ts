import { getMeta, setMeta, removeMeta } from '../db'

export interface LockConfig {
  salt: string
  pinHash: string
  /** Passkey id, set while Face ID is switched on */
  credentialId?: string
  /** Seconds in the background before the app locks again, 0 = every time */
  lockAfter: number
}

export const PIN_LENGTH = 6

const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length))

async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations: 300_000 }, key, 256)
  return toBase64(bits)
}

export const getLock = () => getMeta<LockConfig | null>('lock', null)

export async function enableLock(pin: string): Promise<void> {
  const salt = toBase64(random(16))
  await setMeta('lock', { salt, pinHash: await hashPin(pin, salt), lockAfter: 0 } satisfies LockConfig)
}

export const disableLock = () => removeMeta('lock')

export async function updateLock(changes: Partial<LockConfig>): Promise<void> {
  const lock = await getLock()
  if (lock) await setMeta('lock', { ...lock, ...changes })
}

export async function checkPin(pin: string, lock: LockConfig): Promise<boolean> {
  return (await hashPin(pin, lock.salt)) === lock.pinHash
}

export async function faceIdAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
}

/** Creates a passkey on this iPhone. Face ID confirms the creation. */
export async function registerFaceId(): Promise<string> {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Budget', id: location.hostname },
      user: { id: random(16), name: 'Budget-App', displayName: 'Budget-App' },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null
  if (!credential) throw new Error('Keine Anmeldedaten erhalten')
  return toBase64(credential.rawId)
}

/** Resolves when Face ID succeeded, throws when it was cancelled or failed. */
export async function verifyFaceId(credentialId: string): Promise<void> {
  const result = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: fromBase64(credentialId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })
  if (!result) throw new Error('Face ID fehlgeschlagen')
}
