import { openWith, RSA, toBase64, type Sealed } from '../../eingang/src/crypto'
import { today } from './dates'

/** The inbox at Cloudflare, see eingang/ */
export const EINGANG_URL = 'https://budget-eingang.tankpreis-app.workers.dev'

/** Stored in meta 'applePay', encrypted on the device like all data; never in a backup */
export interface ApplePayConfig {
  url: string
  /** Lets the app fetch and delete payments */
  appToken: string
  /** Goes into the shortcut; it can only add payments */
  shortcutToken: string
  /** Opens the payments the inbox encrypted for this app */
  privateKey: JsonWebKey
  since: number
  lastFetch?: number
}

/** A payment waiting for confirmation, in meta 'applePayPending' */
export interface Pending {
  id: string
  /** In cents, null when the shortcut did not send a readable amount */
  amount: number | null
  merchant: string
  card: string
  date: string
  /** A refund came back to the card */
  refund: boolean
}

const token = (prefix: string) => `${prefix}_${toBase64(crypto.getRandomValues(new Uint8Array(24))).replace(/[+/=]/g, '')}`

/** "23,40 €", "€23.40", "-5,00", "1.234,56 €" → cents with sign; null when there is no amount */
export function parseEuro(text: string): number | null {
  const match = text.replace(/\s/g, '').match(/(-|−)?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|(-|−)?\d+(?:[.,]\d{1,2})?/)
  if (!match) return null
  let value = match[0].replace('−', '-')
  const negative = value.startsWith('-')
  value = value.replace('-', '')
  // The last separator followed by one or two digits is the decimal mark
  const decimal = value.match(/[.,](\d{1,2})$/)
  const whole = (decimal ? value.slice(0, -decimal[0].length) : value).replace(/[.,]/g, '')
  const cents = Number(whole) * 100 + (decimal ? Number(decimal[1].padEnd(2, '0')) : 0)
  if (!Number.isFinite(cents) || cents === 0) return null
  return negative ? -cents : cents
}

/** What the inbox stored, turned into a payment to confirm */
export function toPending(id: string, plain: string): Pending {
  const p = JSON.parse(plain) as Record<string, string>
  const amount = parseEuro(p.betrag || '') ?? parseEuro(p.roh || '')
  const received = p.empfangen ? new Date(p.empfangen) : new Date()
  return {
    id,
    amount: amount === null ? null : Math.abs(amount),
    // From the whole input the amount is taken out of the name
    merchant: (p.haendler || p.name || (p.roh || '').replace(/[-−]?\d[\d.,]*\s*(€|EUR)?/g, '') || 'Apple Pay').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Apple Pay',
    card: (p.karte || '').trim().slice(0, 60),
    date: today(Number.isNaN(received.getTime()) ? new Date() : received),
    refund: amount !== null && amount < 0,
  }
}

async function call(config: Pick<ApplePayConfig, 'url' | 'appToken'>, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.url}${path}`, { ...init, headers: { Authorization: `Bearer ${config.appToken}`, 'Content-Type': 'application/json', ...init.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.fehler ?? 'Der Eingang ist gerade nicht erreichbar.')
  return body
}

/**
 * Creates the keys on this iPhone and connects the inbox. Setting up again keeps working
 * with the old app key; a new device needs the inbox reset first.
 */
export async function setupApplePay(url: string, previous?: ApplePayConfig): Promise<ApplePayConfig> {
  const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['wrapKey', 'unwrapKey'])
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const config: ApplePayConfig = { url, appToken: token('ba'), shortcutToken: token('bp'), privateKey, since: Date.now() }
  await call({ url, appToken: previous?.appToken ?? '' }, '/einrichten', {
    method: 'POST', body: JSON.stringify({ publicKey, appToken: config.appToken, shortcutToken: config.shortcutToken }),
  })
  return config
}

/** All waiting payments, decrypted. They stay in the inbox until `confirmFetched`. */
export async function fetchPayments(config: ApplePayConfig): Promise<Pending[]> {
  const body = await call(config, '/zahlungen') as { zahlungen?: (Sealed & { id: string })[] }
  const key = await crypto.subtle.importKey('jwk', config.privateKey, RSA, false, ['unwrapKey'])
  const result: Pending[] = []
  for (const item of body.zahlungen ?? []) {
    try {
      result.push(toPending(item.id, await openWith(key, item)))
    } catch {
      // Encrypted for an older key of this app: nobody can read it, it only takes up room
      result.push({ id: item.id, amount: null, merchant: 'Nicht lesbare Zahlung', card: '', date: today(), refund: false })
    }
  }
  return result
}

/** Removes payments from the inbox once they are stored on the iPhone */
export async function confirmFetched(config: ApplePayConfig, ids: string[]): Promise<void> {
  if (ids.length > 0) await call(config, '/zahlungen/loeschen', { method: 'POST', body: JSON.stringify({ ids }) })
}

export async function inboxStatus(config: ApplePayConfig): Promise<{ offen: number }> {
  return call(config, '/status') as Promise<{ offen: number }>
}
