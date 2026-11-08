import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Paperclip } from 'lucide-react'
import { db, PARENTS_EXPENSE, type Category, type Entry, type EntryType } from '../db'
import { useApp, useCategories } from '../context'
import { Icon } from '../components/Icon'
import { useStatements } from '../components/ParentsCard'
import { PhotoViewer } from '../components/PhotoViewer'
import { SwipeRow } from '../components/SwipeRow'
import { MonthPicker } from '../components/ui'
import { CategoryIcon, categoryText } from '../components/CategoryIcon'
import { dayLabel, formatDate, monthRange } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { settledItems } from '../lib/parents'

const TYPE_CHIPS: [EntryType | 'all', string][] = [['all', 'Alle'], ['expense', 'Ausgaben'], ['saving', 'Sparen'], ['income', 'Einnahmen']]
const SIGN: Record<EntryType, string> = { expense: '−', saving: '', income: '+' }

export function EntryAmount({ entry }: { entry: Entry }) {
  return <span className={`row-value num amount-${entry.type}`} style={entry.type === 'expense' ? { color: 'var(--label)' } : undefined}>{SIGN[entry.type]}{formatEuro(entry.amount)}</span>
}

function EntryRow({ entry, category, settled }: { entry: Entry; category?: Category; settled: boolean }) {
  const { openEntry, deleteEntry } = useApp()
  const [viewing, setViewing] = useState(false)
  const detail = entry.merchant && entry.note ? `${entry.merchant} · ${entry.note}` : entry.merchant || entry.note
  const photos = useMemo(() => (entry.photos ?? []).map((id) => ({ id })), [entry.photos])
  return (
    <>
      <SwipeRow onEdit={() => openEntry(entry)} onDelete={() => deleteEntry(entry)}>
        {/* The whole row opens the entry; the paperclip on top of it opens the photo */}
        <div className="row entry-row">
          <CategoryIcon category={category} />
          <span className="row-main">
            <button className="row-link row-title" onClick={() => openEntry(entry)}>{category?.name ?? 'Ohne Kategorie'}</button>
            {(detail || entry.recurringId || settled) && (
              <span className="row-sub" style={{ display: 'block' }}>
                {entry.recurringId && <span className="badge">Dauerauftrag</span>}
                {settled && <span className="badge">Erstattet</span>}
                {detail}
              </span>
            )}
          </span>
          {photos.length > 0
            ? (
              <button className="clip-btn" aria-label={photos.length === 1 ? 'Beleg ansehen' : `${photos.length} Belege ansehen`} onClick={() => setViewing(true)}>
                <Paperclip size={17} strokeWidth={2} aria-hidden="true" />
                {photos.length > 1 && <span className="num">{photos.length}</span>}
              </button>
            )
            : entry.thumbnail && <img className="thumb" src={entry.thumbnail} alt="Beleg" />}
          <EntryAmount entry={entry} />
        </div>
      </SwipeRow>
      {/* Outside the row, so its swipe does not react to gestures in the viewer */}
      {viewing && <PhotoViewer photos={photos} caption={`${formatDate(entry.date)} · ${formatEuro(entry.amount)} · ${category?.name ?? ''}`} onClose={() => setViewing(false)} />}
    </>
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
  const { book } = useStatements()
  const settled = useMemo(() => settledItems(book), [book])

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
            {rows.map((entry) => <EntryRow key={entry.id} entry={entry} category={byId.get(entry.categoryId)} settled={entry.categoryId === PARENTS_EXPENSE && settled.has(entry.id)} />)}
          </div>
        </section>
      ))}
      {days.length > 0 && <p className="section-foot">Zum Bearbeiten oder Löschen nach links wischen.</p>}
    </main>
  )
}
