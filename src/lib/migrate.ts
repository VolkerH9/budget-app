import { DEFAULT_CATEGORIES, DEFAULT_GROUPS, newId, SUBSCRIPTION_CATEGORY, type Category, type Entry, type EntryType, type Group, type Meta, type Recurring } from '../db'
import { today } from './dates'

/** Version of the stored data layout. Raise it together with a new step in `migrateData`. */
export const DATA_VERSION = 3

export interface DataSet {
  categories: Category[]
  groups: Group[]
  entries: Entry[]
  recurring: Recurring[]
  meta: Meta[]
}

/** "Food & Restaurants" became two categories. Existing entries stay in Food. */
export function splitFoodCategory(categories: Category[]): Category[] {
  const food = categories.find((c) => c.id === 'exp-food' && c.name === 'Food & Restaurants')
  if (!food || categories.some((c) => c.id === 'exp-restaurants')) return categories
  const shifted = categories.map((c) => {
    if (c.id === food.id) return { ...c, name: 'Food', emoji: c.emoji === '🍽️' ? '🍔' : c.emoji }
    return c.type === 'expense' && c.order > food.order ? { ...c, order: c.order + 1 } : c
  })
  return [...shifted, { ...DEFAULT_CATEGORIES.find((c) => c.id === 'exp-restaurants')!, order: food.order + 1 }]
}

/** Categories that version 3 brought along */
const NEW_IN_3 = ['exp-geschenke', 'exp-oepnv', 'exp-parken', 'exp-strafzettel', 'exp-eltern', 'inc-rueckzahlung']

/** Colours of version 2. A category that still has its old colour gets the new, calmer one. */
const OLD_COLORS: Record<string, string> = {
  'exp-supermarkt': '#2a78d6', 'exp-food': '#eb6834', 'exp-restaurants': '#0e9aa7', 'exp-drogerie': '#e87ba4',
  'exp-shopping': '#6250d6', 'exp-sport': '#1baf7a', 'exp-freizeit': '#eda100', 'exp-vacation': '#008300',
  'exp-mobility': '#5b6b82', 'exp-studium': '#a4703a', 'exp-abos': '#e34948', 'exp-diverse': '#8e8e93',
  'sav-investitionen': '#6250d6', 'inc-income': '#008300', 'inc-parents': '#1baf7a', 'inc-oma': '#eda100',
}

export function defaultSubscriptions(categories: Category[], now = today()): Recurring[] {
  const categoryId = categories.find((c) => c.id === SUBSCRIPTION_CATEGORY)?.id
    ?? categories.find((c) => c.type === 'expense')?.id
  if (!categoryId) return []
  const draft = (name: string, interval: 'monthly' | 'yearly'): Recurring => ({
    id: newId(), name, amount: 0, type: 'expense', categoryId, interval,
    bookingDay: Number(now.slice(8, 10)), startDate: now, nextDue: now, paused: true, subscription: {},
  })
  return [draft('Whoop', 'yearly'), draft('Claude', 'monthly')]
}

/** Overcategories, the new categories, icons and the two prefilled Abos. */
function toVersion3(data: DataSet, now: string): DataSet {
  const groups = [...data.groups, ...DEFAULT_GROUPS.filter((g) => !data.groups.some((own) => own.id === g.id))]
  const known = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]))
  const updated = data.categories.map((c): Category => {
    const preset = known.get(c.id)
    if (!preset) return { ...c, symbol: c.symbol ?? 'emoji' }
    return {
      ...c,
      name: c.id === 'exp-mobility' && c.name === 'Mobility/Auto' ? 'Auto' : c.name,
      icon: c.icon ?? preset.icon,
      symbol: c.symbol ?? 'icon',
      color: c.color === OLD_COLORS[c.id] ? preset.color : c.color,
      groupId: c.groupId ?? preset.groupId,
    }
  })
  const added = DEFAULT_CATEGORIES.filter((c) => NEW_IN_3.includes(c.id) && !updated.some((own) => own.id === c.id))
  const all = [...updated, ...added.map((c) => ({ ...c, symbol: 'icon' as const }))]

  // Presets in their new order, own categories behind them in their previous order
  const rank = (c: Category) => {
    const index = DEFAULT_CATEGORIES.findIndex((d) => d.id === c.id)
    return index === -1 ? 1000 + c.order : index
  }
  const categories = (['expense', 'saving', 'income'] as EntryType[]).flatMap((type) =>
    all.filter((c) => c.type === type).sort((a, b) => rank(a) - rank(b)).map((c, order) => ({ ...c, order })))

  const hasSubscriptions = data.recurring.some((r) => r.subscription)
  return {
    ...data,
    groups,
    categories,
    recurring: hasSubscriptions ? data.recurring : [...data.recurring, ...defaultSubscriptions(categories, now)],
  }
}

/** Brings data of an older version up to date. Entries keep their ids and categories. */
export function migrateData(data: DataSet, from: number, now = today()): DataSet {
  let result = data
  if (from < 2) result = { ...result, categories: splitFoodCategory(result.categories) }
  if (from < 3) result = toVersion3(result, now)
  return result
}

/** Data of a fresh installation */
export function freshData(now = today()): DataSet {
  const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c, symbol: 'icon' as const }))
  return { categories, groups: [...DEFAULT_GROUPS], entries: [], recurring: defaultSubscriptions(categories, now), meta: [] }
}
