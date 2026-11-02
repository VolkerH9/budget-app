// All amounts are stored as whole cents to avoid floating point errors.

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const euroWhole = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

export const formatEuro = (cents: number) => euro.format(cents / 100)
export const formatEuroWhole = (cents: number) => euroWhole.format(cents / 100)
export const formatPercent = (ratio: number) => `${percent.format(ratio * 100)} %`

/** "12,5" -> 1250. Returns null for anything that is not a positive amount. */
export function parseAmount(text: string): number | null {
  const clean = text.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null
  const cents = Math.round(Number(clean) * 100)
  return cents > 0 && Number.isSafeInteger(cents) ? cents : null
}

/** 1250 -> "12,5", the text shown on the keypad when an entry is edited. */
export function amountToInput(cents: number): string {
  const whole = Math.floor(cents / 100)
  const rest = cents % 100
  if (rest === 0) return String(whole)
  return `${whole},${String(rest).padStart(2, '0').replace(/0$/, '')}`
}

/** Applies a keypad press to the amount text. */
export function pressKey(text: string, key: string): string {
  if (key === 'back') return text.slice(0, -1)
  if (key === ',') {
    if (text.includes(',')) return text
    return text === '' ? '0,' : `${text},`
  }
  const [whole, decimals] = text.split(',')
  if (decimals !== undefined && decimals.length >= 2) return text
  if (decimals === undefined && whole.length >= 7) return text
  if (text === '0') return key
  return text + key
}

/** Keeps thousands separators while typing: "1234,5" -> "1.234,5" */
export function displayInput(text: string): string {
  if (text === '') return '0'
  const [whole, decimals] = text.split(',')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decimals === undefined ? grouped : `${grouped},${decimals}`
}
