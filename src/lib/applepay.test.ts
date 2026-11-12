import { describe, expect, it } from 'vitest'
import { hash, openWith, RSA, sealFor } from '../../eingang/src/crypto'
import { DEFAULT_CATEGORIES, newId, type Entry } from '../db'
import { parseEuro, toPending } from './applepay'
import { merchantKey, suggestCategory } from './suggest'

const entry = (over: Partial<Entry>): Entry => ({ id: newId(), type: 'expense', amount: 1000, categoryId: 'exp-food', date: '2026-11-01', createdAt: 1, ...over })

describe('Apple Pay: Beträge und Zahlungen lesen', () => {
  it('liest Beträge in den üblichen Schreibweisen', () => {
    expect(parseEuro('23,40 €')).toBe(2340)
    expect(parseEuro('€23.40')).toBe(2340)
    expect(parseEuro('1.234,56 €')).toBe(123456)
    expect(parseEuro('1,234.56')).toBe(123456)
    expect(parseEuro('-5,00 €')).toBe(-500)
    expect(parseEuro('12 €')).toBe(1200)
    expect(parseEuro('8,5')).toBe(850)
    expect(parseEuro('kein Betrag')).toBeNull()
  })
  it('macht aus dem Gespeicherten eine Zahlung zum Bestätigen', () => {
    const p = toPending('p:1', JSON.stringify({ betrag: '23,40 €', haendler: '  REWE   Markt ', karte: 'Sparkasse Girocard', empfangen: '2026-11-12T18:30:00.000Z' }))
    expect(p).toMatchObject({ id: 'p:1', amount: 2340, merchant: 'REWE Markt', card: 'Sparkasse Girocard', refund: false })
    expect(p.date).toMatch(/^2026-11-1[23]$/)
    // Without the properties the whole input still gives merchant and amount
    expect(toPending('p:2', JSON.stringify({ roh: 'Aral 61,02 €' }))).toMatchObject({ amount: 6102, merchant: 'Aral' })
    expect(toPending('p:3', JSON.stringify({ betrag: '-4,99 €', haendler: 'Zalando' }))).toMatchObject({ amount: 499, refund: true })
  })
})

describe('Apple Pay: verschlüsselt für die App', () => {
  it('kann nur der private Schlüssel der App öffnen', async () => {
    const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['wrapKey', 'unwrapKey'])
    const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey)
    const sealed = await sealFor(publicKey, '{"betrag":"23,40 €"}')
    expect(JSON.stringify(sealed)).not.toContain('23,40')
    expect(await openWith(pair.privateKey, sealed)).toBe('{"betrag":"23,40 €"}')
    const other = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['wrapKey', 'unwrapKey'])
    await expect(openWith(other.privateKey, sealed)).rejects.toThrow()
    expect(await hash('abc')).toBe(await hash('abc'))
    expect(await hash('abc')).not.toBe(await hash('abd'))
  })
})

describe('Kategorie vorschlagen', () => {
  const history = [
    entry({ merchant: 'Ali Kebab Haus', categoryId: 'exp-food', note: 'Döner' }),
    entry({ merchant: 'Edeka Center', categoryId: 'exp-supermarkt' }),
    entry({ note: 'Kino mit Lena', categoryId: 'exp-freizeit' }),
  ]
  const s = (merchant: string, note = '', learned: Record<string, string> = {}) => suggestCategory({ merchant, note }, history, DEFAULT_CATEGORIES, learned)

  it('erkennt Händler an Stichwörtern', () => {
    expect(s('REWE Markt GmbH')?.categoryId).toBe('exp-supermarkt')
    expect(s('ARAL Tankstelle')?.categoryId).toBe('exp-mobility')
    expect(s('DB Fernverkehr')?.categoryId).toBe('exp-oepnv')
    expect(s('Rossmann 123')?.categoryId).toBe('exp-drogerie')
    expect(s('Unbekannt XY')).toBeNull()
  })
  it('lernt aus früheren Buchungen und gemerkten Händlern', () => {
    expect(s('EDEKA CENTER Hamburg')?.categoryId).toBe('exp-supermarkt')
    expect(s('Unbekannt XY', '', { [merchantKey('Unbekannt XY')]: 'exp-geschenke' })?.categoryId).toBe('exp-geschenke')
    expect(merchantKey('REWE Markt GmbH, Hamburg')).toBe('rewe')
  })
  it('richtet sich zuerst nach deiner Notiz', () => {
    expect(s('REWE', 'Döner')?.categoryId).toBe('exp-food')
    expect(s('Unbekannt XY', 'Kino')?.categoryId).toBe('exp-freizeit')
    expect(s('Unbekannt XY', 'Supermarkt')).toMatchObject({ categoryId: 'exp-supermarkt', reason: '„Supermarkt“ steht in deiner Notiz' })
    expect(s('Unbekannt XY', 'Tanken')?.categoryId).toBe('exp-mobility')
  })
})
