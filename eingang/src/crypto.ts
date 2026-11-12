// Shared by the inbox (encrypting) and the app (decrypting). Each payment gets its own AES key,
// which is wrapped with the app's public RSA key, so only the app can read a stored payment.

export interface Sealed {
  /** The AES key, wrapped with RSA-OAEP */
  k: string
  iv: string
  d: string
}

export const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let text = ''
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(text)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export async function sealFor(publicKey: JsonWebKey, plain: string): Promise<Sealed> {
  const rsa = await crypto.subtle.importKey('jwk', publicKey, RSA, false, ['wrapKey'])
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain))
  const wrapped = await crypto.subtle.wrapKey('raw', key, rsa, RSA)
  return { k: toBase64(wrapped), iv: toBase64(iv), d: toBase64(data) }
}

export async function openWith(privateKey: CryptoKey, sealed: Sealed): Promise<string> {
  const key = await crypto.subtle.unwrapKey('raw', fromBase64(sealed.k), privateKey, RSA, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(sealed.iv) }, key, fromBase64(sealed.d))
  return new TextDecoder().decode(plain)
}

export async function hash(token: string): Promise<string> {
  return toBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}
