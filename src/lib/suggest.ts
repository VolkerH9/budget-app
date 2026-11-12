import type { Category, Entry } from '../db'

/** Lower case, without accents, umlauts written out, punctuation as spaces */
export function normalize(text: string): string {
  return text.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The merchant as a key: "REWE Markt GmbH, Hamburg" and "rewe" become the same */
export function merchantKey(merchant: string): string {
  const words = normalize(merchant).split(' ').filter((w) => w.length > 1 && !STOP.has(w))
  return words.slice(0, 2).join(' ')
}

const STOP = new Set(['gmbh', 'ag', 'kg', 'ohg', 'ug', 'co', 'und', 'markt', 'filiale', 'sagt', 'danke', 'de', 'www', 'com', 'hamburg', 'berlin', 'muenchen'])

/** Words that point to a category, keyed by the ids of the preset categories */
const KEYWORDS: Record<string, string[]> = {
  'exp-supermarkt': ['rewe', 'edeka', 'aldi', 'lidl', 'penny', 'netto', 'kaufland', 'real', 'tegut', 'globus', 'supermarkt', 'einkauf', 'lebensmittel'],
  'exp-drogerie': ['dm', 'rossmann', 'mueller', 'budni', 'drogerie', 'apotheke'],
  'exp-food': ['mcdonald', 'mcdonalds', 'burger', 'king', 'kfc', 'subway', 'doener', 'kebab', 'baecker', 'baeckerei', 'backhaus', 'backwerk', 'imbiss', 'mensa', 'snack', 'pizza'],
  'exp-restaurants': ['restaurant', 'ristorante', 'trattoria', 'pizzeria', 'sushi', 'cafe', 'kaffee', 'starbucks', 'bar', 'essen', 'bistro', 'brauhaus'],
  'exp-shopping': ['zara', 'h', 'primark', 'zalando', 'about', 'uniqlo', 'snipes', 'kleidung', 'schuhe', 'shopping', 'amazon'],
  'exp-sport': ['fitness', 'mcfit', 'urban', 'sports', 'decathlon', 'gym', 'sport', 'schwimmbad'],
  'exp-freizeit': ['kino', 'cinemaxx', 'uci', 'theater', 'museum', 'konzert', 'eventim', 'bowling', 'freizeit'],
  'exp-vacation': ['hotel', 'airbnb', 'booking', 'lufthansa', 'ryanair', 'eurowings', 'urlaub'],
  'exp-geschenke': ['geschenk', 'blumen'],
  'exp-studium': ['thalia', 'buch', 'buecher', 'copyshop', 'uni', 'studium'],
  'exp-abos': ['spotify', 'netflix', 'disney', 'apple', 'abo', 'icloud'],
  'exp-mobility': ['aral', 'shell', 'esso', 'jet', 'total', 'totalenergies', 'tankstelle', 'tanken', 'werkstatt', 'auto'],
  'exp-oepnv': ['db', 'bahn', 'hvv', 'bvg', 'mvg', 'flixbus', 'flixtrain', 'ticket', 'oepnv'],
  'exp-parken': ['parkhaus', 'parken', 'apcoa', 'contipark', 'parking', 'easypark'],
}

export interface Suggestion {
  categoryId: string
  /** Why, for the line under the suggestion */
  reason: string
}

/**
 * The most likely expense category for a payment. In this order: what was chosen for this
 * merchant before, earlier entries with the same words in the note, the category's own name
 * in the note, earlier entries of the merchant, then keywords.
 */
export function suggestCategory(
  payment: { merchant: string; note: string },
  entries: Entry[],
  categories: Category[],
  learned: Record<string, string>,
): Suggestion | null {
  const expense = categories.filter((c) => c.type === 'expense')
  const exists = (id: string | undefined) => !!id && expense.some((c) => c.id === id)
  const name = (id: string) => expense.find((c) => c.id === id)!.name
  const noteWords = normalize(payment.note).split(' ').filter((w) => w.length > 2)
  const key = merchantKey(payment.merchant)
  const mostCommon = (list: Entry[]) => {
    const counts = new Map<string, number>()
    for (const e of list) if (exists(e.categoryId)) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  }

  // A note says best what it was ("Döner"), so it beats the merchant
  if (noteWords.length > 0) {
    const byName = expense.find((c) => noteWords.some((w) => normalize(c.name).split(' ').includes(w)))
    if (byName) return { categoryId: byName.id, reason: `„${byName.name}“ steht in deiner Notiz` }
    const earlier = mostCommon(entries.filter((e) => e.type === 'expense' && e.note && noteWords.some((w) => normalize(e.note!).split(' ').includes(w))))
    if (earlier) return { categoryId: earlier, reason: 'wie frühere Buchungen mit dieser Notiz' }
    for (const [id, words] of Object.entries(KEYWORDS)) if (exists(id) && noteWords.some((w) => words.includes(w))) return { categoryId: id, reason: 'passt zu deiner Notiz' }
  }
  if (key && exists(learned[key])) return { categoryId: learned[key], reason: `so hast du „${payment.merchant}“ zuletzt zugeordnet` }
  if (key) {
    const earlier = mostCommon(entries.filter((e) => e.type === 'expense' && e.merchant && merchantKey(e.merchant) === key))
    if (earlier) return { categoryId: earlier, reason: `wie frühere Buchungen bei ${payment.merchant}` }
    const words = normalize(payment.merchant).split(' ')
    for (const [id, list] of Object.entries(KEYWORDS)) if (exists(id) && words.some((w) => w.length > 1 && list.includes(w))) return { categoryId: id, reason: `${payment.merchant} klingt nach ${name(id)}` }
  }
  return null
}
