import type { LegacyLock } from './vault'

const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length))

/** Length of the PIN of the previous version */
export const PIN_LENGTH = 6

async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations: 300_000 }, key, 256)
  return toBase64(bits)
}

export async function checkLegacyPin(pin: string, lock: LegacyLock): Promise<boolean> {
  return (await hashPin(pin, lock.salt)) === lock.pinHash
}

/** Face ID of the previous version: only confirms, releases no key. */
export async function verifyLegacyFaceId(credentialId: string): Promise<void> {
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

export async function faceIdAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) return false
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
}

/** The iPhone can create passkeys, but not release a secret for web apps. */
export class NoPrfError extends Error {}

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer } }
const prfOf = (credential: PublicKeyCredential) =>
  (credential.getClientExtensionResults() as { prf?: PrfResults }).prf

/**
 * Face ID unlocks a secret that is bound to a passkey on this iPhone (WebAuthn PRF).
 * The secret, never stored anywhere, unlocks the data key.
 */
export async function readFaceIdSecret(credentialId: string, salt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: fromBase64(credentialId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null
  if (!credential) throw new Error('Face ID fehlgeschlagen')
  const secret = prfOf(credential)?.results?.first
  if (!secret) throw new NoPrfError('Kein Face-ID-Geheimnis erhalten')
  return secret
}

/** Creates the passkey and reads its secret once. Face ID confirms both steps. */
export async function registerFaceId(): Promise<{ credentialId: string; salt: Uint8Array<ArrayBuffer>; secret: ArrayBuffer }> {
  const salt = random(32)
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Budget', id: location.hostname },
      // A fixed user replaces an earlier passkey of this app instead of adding another one
      user: { id: new TextEncoder().encode('budget-app-lock'), name: 'Budget-App', displayName: 'Budget-App' },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null
  if (!credential) throw new Error('Keine Anmeldedaten erhalten')
  const credentialId = toBase64(credential.rawId)
  const prf = prfOf(credential)
  if (prf?.enabled === false) throw new NoPrfError('Passkey ohne PRF')
  const secret = prf?.results?.first ?? await readFaceIdSecret(credentialId, salt)
  return { credentialId, salt, secret }
}
