import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, PARENTS_EXPENSE, type Category, type Entry, type EntryType } from '../db'
import { useApp, useCategories } from '../context'
import { Icon } from '../components/Icon'
import { SwipeRow } from '../components/SwipeRow'
import { MonthPicker } from '../components/ui'
import { CategoryIcon, categoryText } from '../components/CategoryIcon'
import { dayLabel, monthRange } from '../lib/dates'
import { formatEuro } from '../lib/format'

const TYPE_CHIPS: [EntryType | 'all', string][] = [['all', 'Alle'], ['expense', 'Ausgaben'], ['saving', 'Sparen'], ['income', 'Einnahmen']]
const SIGN: Record<EntryType, string> = { expense: '−', saving: '', income: '+' }

export function EntryAmount({ entry }: { entry: Entry }) {
  return <span className={`row-value num amount-${entry.type}`} style={entry.type === 'expense' ? { color: 'var(--label)' } : undefined}>{SIGN[entry.type]}{formatEuro(entry.amount)}</span>
}

function EntryRow({ entry, category }: { entry: Entry; category?: Category }) {
  const { openEntry, deleteEntry } = useApp()
  const detail = entry.merchant && entry.note ? `${entry.merchant} · ${entry.note}` : entry.merchant || entry.note
  return (
    <SwipeRow onEdit={() => openEntry(entry)} onDelete={() => deleteEntry(entry)}>
      <button className="row" onClick={() => openEntry(entry)}>
        <CategoryIcon category={category} />
        <span className="row-main">
          <span className="row-title" style={{ display: 'block' }}>{category?.name ?? 'Ohne Kategorie'}</span>
          {(detail || entry.recurringId || entry.refunded) && (
            <span className="row-sub" style={{ display: 'block' }}>
              {entry.recurringId && <span className="badge">Dauerauftrag</span>}
              {entry.categoryId === PARENTS_EXPENSE && entry.refunded && <span className="badge">Erstattet</span>}
              {detail}
            </span>
          )}
        </span>
        {entry.thumbnail && <img className="thumb" src={entry.thumbnail} alt="Beleg" />}
        <EntryAmount entry={entry} />
      </button>
    </SwipeRow>
  )
}

export function Entries() {
  const { month, setMonth } = useApp()
  const categories = useCategories()
  const [type, setType] = useState<EntryType | 'all'>('all')
  const [categoryId, setCategoryId] = useState('')
  const [query, setQuery] = useState('')
  const [allMonths, setAllMonths] = useState(false)

  const entries = useLiveQuery(() => {
    const [from, to] = monthRange(month)
    const range = allMonths ? db.entries.orderBy('date') : db.entries.where('date').between(from, to, true, true)
    return range.toArray()
  }, [month, allMonths], [] as Entry[])

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries
      .filter((e) => (type === 'all' || e.type === type) && (!categoryId || e.categoryId === categoryId))
      .filter((e) => !needle || `${e.note ?? ''} ${e.merchant ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  }, [entries, type, categoryId, query])

  const days = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of filtered) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return [...map]
  }, [filtered])

  const pickable = categories.filter((c) => type === 'all' || c.type === type)
  const selected = byId.get(categoryId)
  const hasFilter = type !== 'all' || categoryId || query.trim()

  return (
    <main className="page">
      <h1 className="page-title">Einträge</h1>
      {!allMonths && <MonthPicker month={month} onChange={setMonth} />}
      <label className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Notizen und Händler suchen" aria-label="Suche" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="chips">
        {TYPE_CHIPS.map(([key, label]) => (
          <button key={key} className="chip" aria-pressed={type === key} onClick={() => { setType(key); setCategoryId('') }}>{label}</button>
        ))}
        <button className="chip" style={{ position: 'relative' }} aria-pressed={!!categoryId}>
          {selected ? categoryText(selected) : 'Kategorie'} ▾
          <select
            aria-label="Nach Kategorie filtern"
            style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0 }}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Alle Kategorien</option>
            {pickable.map((c) => <option key={c.id} value={c.id}>{categoryText(c)}</option>)}
          </select>
        </button>
        <button className="chip" aria-pressed={allMonths} onClick={() => setAllMonths(!allMonths)}>Alle Monate</button>
      </div>

      {days.length === 0 && (
        <div className="empty">
          <b>{hasFilter ? 'Nichts gefunden' : 'Noch keine Einträge'}</b>
          {hasFilter ? 'Ändere die Filter oder die Suche.' : 'Tippe auf das Plus, um etwas einzutragen.'}
        </div>
      )}

      {days.map(([date, rows]) => (
        <section key={date}>
          <div className="day-title"><span>{dayLabel(date)}</span></div>
          <div className="group">
            {rows.map((entry) => <EntryRow key={entry.id} entry={entry} category={byId.get(entry.categoryId)} />)}
          </div>
        </section>
      ))}
      {days.length > 0 && <p className="section-foot">Zum Bearbeiten oder Löschen nach links wischen.</p>}
    </main>
  )
}
