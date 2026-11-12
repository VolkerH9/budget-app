import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Paperclip, SlidersHorizontal, Tag } from 'lucide-react'
import { db, isParentsExpense, type Category, type Entry, type EntryType, type Label } from '../db'
import { useApp, useCategories, useGroups, useLabels } from '../context'
import { Icon } from '../components/Icon'
import { useStatements } from '../components/ParentsCard'
import { LabelChip } from '../components/Labels'
import { PhotoViewer } from '../components/PhotoViewer'
import { SwipeRow } from '../components/SwipeRow'
import { CountUp, MonthPicker, PageHead, Sheet } from '../components/ui'
import { CategoryIcon } from '../components/CategoryIcon'
import { dayLabel, formatDate, monthRange } from '../lib/dates'
import { amountToInput, formatEuro, formatPercent, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { applyBulk } from '../lib/labels'
import { activeFilters, EMPTY_FILTER, filterEntries, summarizeSelection, type EntryFilter, type SelectionSummary } from '../lib/selection'
import { settledItems } from '../lib/parents'

const TYPE_CHIPS: [EntryType | 'all', string][] = [['all', 'Alle'], ['expense', 'Ausgaben'], ['saving', 'Sparen'], ['income', 'Einnahmen']]
const SIGN: Record<EntryType, string> = { expense: '−', saving: '', income: '+' }

export function EntryAmount({ entry }: { entry: Entry }) {
  return <span className={`row-value num amount-${entry.type}`} style={entry.type === 'expense' ? { color: 'var(--label)' } : undefined}>{SIGN[entry.type]}{formatEuro(entry.amount)}</span>
}

function EntryRow({ entry, category, settled, labels, selecting, checked, onToggle }: {
  entry: Entry; category?: Category; settled: boolean; labels: Map<string, Label>
  selecting?: boolean; checked?: boolean; onToggle?: () => void
}) {
  const { openEntry, deleteEntry } = useApp()
  const [viewing, setViewing] = useState(false)
  const detail = entry.merchant && entry.note ? `${entry.merchant} · ${entry.note}` : entry.merchant || entry.note
  const photos = useMemo(() => (entry.photos ?? []).map((id) => ({ id })), [entry.photos])
  if (selecting) {
    return (
      <button className={checked ? 'row select-row on' : 'row select-row'} role="checkbox" aria-checked={!!checked} onClick={onToggle}>
        <span className={checked ? 'check on' : 'check'} aria-hidden="true">{checked && <Check size={16} strokeWidth={3} />}</span>
        <CategoryIcon category={category} size={30} />
        <span className="row-main">
          <span className="row-title" style={{ display: 'block' }}>{category?.name ?? 'Ohne Kategorie'}</span>
          {detail && <span className="row-sub" style={{ display: 'block' }}>{detail}</span>}
          {!!entry.labels?.length && (
            <span className="row-labels">
              {entry.labels.map((id) => labels.get(id)).filter((l) => !!l).map((l) => <LabelChip key={l.id} label={l} small />)}
            </span>
          )}
        </span>
        <EntryAmount entry={entry} />
      </button>
    )
  }
  return (
    <>
      <SwipeRow onEdit={() => openEntry(entry)} onDelete={() => deleteEntry(entry)}>
        {/* The whole row opens the entry; the paperclip on top of it opens the photo */}
        <div className="row entry-row">
          <CategoryIcon category={category} />
          <span className="row-main">
            <button className="row-link row-title" onClick={() => openEntry(entry)}>{category?.name ?? 'Ohne Kategorie'}</button>
            {(detail || entry.recurringId || settled || entry.forParents) && (
              <span className="row-sub" style={{ display: 'block' }}>
                {entry.recurringId && <span className="badge">Dauerauftrag</span>}
                {settled && <span className="badge">Erstattet</span>}
                {entry.forParents && !settled && <span className="badge">Eltern</span>}
                {detail}
              </span>
            )}
            {!!entry.labels?.length && (
              <span className="row-labels">
                {entry.labels.map((id) => labels.get(id)).filter((l) => !!l).map((l) => <LabelChip key={l.id} label={l} small />)}
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

/** Filters for the list and the selection: categories and overcategories, labels, dates, amounts */
function FilterSheet({ filter, onChange, onClose }: { filter: EntryFilter; onChange: (f: EntryFilter) => void; onClose: () => void }) {
  const categories = useCategories()
  const groups = useGroups()
  const labels = useLabels()
  const [min, setMin] = useState(filter.min === null ? '' : amountToInput(filter.min))
  const [max, setMax] = useState(filter.max === null ? '' : amountToInput(filter.max))
  const types = filter.type === 'all' ? ['expense', 'saving', 'income'] : [filter.type]
  const toggle = (list: string[], ids: string[]) => {
    const all = ids.every((id) => list.includes(id))
    return all ? list.filter((id) => !ids.includes(id)) : [...new Set([...list, ...ids])]
  }
  const close = () => {
    onChange({ ...filter, min: min.trim() ? parseAmount(min) : null, max: max.trim() ? parseAmount(max) : null })
    onClose()
  }
  const shownGroups = groups.filter((g) => types.includes(g.type))
  const loose = categories.filter((c) => types.includes(c.type) && !(c.groupId && groups.some((g) => g.id === c.groupId)))
  const CategoryRow = ({ c, indent }: { c: Category; indent?: boolean }) => (
    <button className="row" role="checkbox" aria-checked={filter.categoryIds.includes(c.id)} style={indent ? { paddingLeft: 36 } : undefined} onClick={() => onChange({ ...filter, categoryIds: toggle(filter.categoryIds, [c.id]) })}>
      <span className={filter.categoryIds.includes(c.id) ? 'check on' : 'check'} aria-hidden="true">{filter.categoryIds.includes(c.id) && <Check size={16} strokeWidth={3} />}</span>
      <CategoryIcon category={c} size={26} />
      <span className="row-main">{c.name}</span>
    </button>
  )
  return (
    <Sheet title="Filter" onClose={close} full action={{ label: 'Fertig', onClick: close }}>
      <h3 className="section-title">Zeitraum</h3>
      <div className="group">
        <label className="row"><span className="row-main">Von</span><input type="date" aria-label="Filter von" value={filter.from} onChange={(e) => onChange({ ...filter, from: e.target.value })} /></label>
        <label className="row"><span className="row-main">Bis</span><input type="date" aria-label="Filter bis" value={filter.to} min={filter.from || undefined} onChange={(e) => onChange({ ...filter, to: e.target.value })} /></label>
      </div>
      <p className="section-foot">Mit Zeitraum gilt er statt des Monats.</p>

      <h3 className="section-title">Betrag in €</h3>
      <div className="group">
        <label className="row"><span className="row-main">Ab</span><input type="text" inputMode="decimal" placeholder="0" aria-label="Betrag ab" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label className="row"><span className="row-main">Bis</span><input type="text" inputMode="decimal" placeholder="beliebig" aria-label="Betrag bis" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>

      {labels.length > 0 && (
        <>
          <h3 className="section-title">Labels</h3>
          <div className="label-row" style={{ padding: '0 4px' }}>
            {labels.map((l) => <LabelChip key={l.id} label={l} pressed={filter.labelIds.includes(l.id)} onClick={() => onChange({ ...filter, labelIds: toggle(filter.labelIds, [l.id]) })} />)}
          </div>
        </>
      )}

      <h3 className="section-title">Kategorien</h3>
      <div className="group">
        {shownGroups.map((g) => {
          const ids = categories.filter((c) => c.groupId === g.id).map((c) => c.id)
          const all = ids.length > 0 && ids.every((id) => filter.categoryIds.includes(id))
          return (
            <div key={g.id}>
              <button className="row" role="checkbox" aria-checked={all} onClick={() => onChange({ ...filter, categoryIds: toggle(filter.categoryIds, ids) })}>
                <span className={all ? 'check on' : 'check'} aria-hidden="true">{all && <Check size={16} strokeWidth={3} />}</span>
                <span className="dot" style={{ background: g.color }} />
                <span className="row-main"><b>{g.name}</b></span>
              </button>
              {categories.filter((c) => c.groupId === g.id).map((c) => <CategoryRow key={c.id} c={c} indent />)}
            </div>
          )
        })}
        {loose.map((c) => <CategoryRow key={c.id} c={c} />)}
      </div>
      <button className="row center tint" style={{ marginTop: 16, borderRadius: 12 }} onClick={() => { setMin(''); setMax(''); onChange({ ...EMPTY_FILTER, type: filter.type, query: filter.query }) }}>Filter zurücksetzen</button>
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

/** Sum, count, average, dates and split by category of the chosen entries */
function SelectionResult({ entries, onClose }: { entries: Entry[]; onClose: () => void }) {
  const categories = useCategories()
  const s = summarizeSelection(entries, categories)
  const Parts = ({ parts }: { parts: SelectionSummary['parts'] }) => (
    <div className="group">
      {parts.map((p) => (
        <div key={p.categoryId} className="row part-row">
          <CategoryIcon category={p.category} size={28} />
          <span className="row-main">
            <span className="row-title" style={{ display: 'block' }}>{p.category?.name ?? 'Ohne Kategorie'} <span className="row-sub">· {p.count}×</span></span>
            <span className="part-bar"><span style={{ width: `${Math.max(2, p.share * 100)}%`, background: p.category?.color }} /></span>
          </span>
          <span className="part-value num"><b>{formatEuro(p.amount)}</b><span className="row-sub">{formatPercent(p.share)}</span></span>
        </div>
      ))}
    </div>
  )
  return (
    <Sheet title="Auswahl" onClose={onClose} full action={{ label: 'Fertig', onClick: onClose }}>
      <div className="card stat-card">
        <span className="row-sub">{s.income > 0 && s.total === 0 ? 'Einnahmen' : 'Summe'}</span>
        <CountUp cents={s.total > 0 || s.income === 0 ? s.total : s.income} className="hero-num" />
        <div className="mini-stats num">
          <span>{s.count} {s.count === 1 ? 'Buchung' : 'Buchungen'}</span>
          <span>Ø {formatEuro(s.average)} pro Buchung</span>
          {s.first && <span>{s.first === s.last ? formatDate(s.first) : `${formatDate(s.first)} – ${formatDate(s.last!)}`}</span>}
          {s.income > 0 && s.total > 0 && <span>+ {formatEuro(s.income)} Einnahmen</span>}
        </div>
      </div>
      {s.parts.length > 0 && <><h3 className="section-title">Nach Kategorien</h3><Parts parts={s.parts} /></>}
      {s.incomeParts.length > 0 && s.parts.length > 0 && <><h3 className="section-title">Einnahmen</h3><Parts parts={s.incomeParts} /></>}
      {s.incomeParts.length > 0 && s.parts.length === 0 && <><h3 className="section-title">Nach Kategorien</h3><Parts parts={s.incomeParts} /></>}
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

export function Entries() {
  const { month, setMonth, toast, alert } = useApp()
  const categories = useCategories()
  const allLabels = useLabels()
  const labelsById = useMemo(() => new Map(allLabels.map((l) => [l.id, l])), [allLabels])
  const [filter, setFilter] = useState<EntryFilter>(EMPTY_FILTER)
  const [allMonths, setAllMonths] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [showResult, setShowResult] = useState(false)
  const [labelling, setLabelling] = useState(false)
  const byRange = !!(filter.from || filter.to)

  const entries = useLiveQuery(() => {
    const [from, to] = monthRange(month)
    const range = allMonths || byRange ? db.entries.orderBy('date') : db.entries.where('date').between(from, to, true, true)
    return range.toArray()
  }, [month, allMonths, byRange], [] as Entry[])

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const { book } = useStatements()
  const settled = useMemo(() => settledItems(book), [book])
  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter])
  const selected = useMemo(() => entries.filter((e) => chosen.has(e.id)), [entries, chosen])
  const summary = useMemo(() => summarizeSelection(selected, categories), [selected, categories])

  const days = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of filtered) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return [...map]
  }, [filtered])

  // The selection bar takes the place of the tab bar, as in the iPhone's Photos app
  useEffect(() => {
    document.querySelector('.app')?.classList.toggle('selecting', selecting)
    return () => document.querySelector('.app')?.classList.remove('selecting')
  }, [selecting])

  const count = activeFilters(filter)
  const hasFilter = filter.type !== 'all' || count > 0 || filter.query.trim()
  const toggle = (id: string) => {
    haptic()
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }
  const stopSelecting = () => { setSelecting(false); setChosen(new Set()) }
  const allChosen = filtered.length > 0 && filtered.every((e) => chosen.has(e.id))

  const labelAction = (labelId: string) => {
    const label = labelsById.get(labelId)
    if (!label) return
    const add = applyBulk(selected, { kind: 'addLabel', labelId })
    const remove = applyBulk(selected, { kind: 'removeLabel', labelId })
    const run = async (changed: Entry[], text: string) => {
      const before = selected.filter((e) => changed.some((c) => c.id === e.id))
      await db.entries.bulkPut(changed)
      haptic()
      toast(text, () => { db.entries.bulkPut(before) })
    }
    alert({
      title: `„${label.name}“`,
      message: `${selected.length} ausgewählte ${selected.length === 1 ? 'Buchung' : 'Buchungen'}. ${add.length} ohne dieses Label, ${remove.length} mit.`,
      buttons: [
        ...(add.length > 0 ? [{ label: `Zuweisen (${add.length})`, style: 'strong' as const, onClick: () => { run(add, `Label bei ${add.length} ${add.length === 1 ? 'Buchung' : 'Buchungen'} zugewiesen`) } }] : []),
        ...(remove.length > 0 ? [{ label: `Entfernen (${remove.length})`, style: 'destructive' as const, onClick: () => { run(remove, `Label bei ${remove.length} ${remove.length === 1 ? 'Buchung' : 'Buchungen'} entfernt`) } }] : []),
        { label: 'Abbrechen' },
      ],
    })
  }

  return (
    <main className="page">
      <PageHead title="Einträge">
        <button className="link-btn select-toggle" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>{selecting ? 'Fertig' : 'Auswählen'}</button>
      </PageHead>
      {!allMonths && !byRange && <MonthPicker month={month} onChange={setMonth} />}
      {byRange && (
        <button className="range-chip" onClick={() => setFiltering(true)}>
          {filter.from ? formatDate(filter.from) : 'Anfang'} – {filter.to ? formatDate(filter.to) : 'heute'}
        </button>
      )}
      <label className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Notizen und Händler suchen" aria-label="Suche" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
      </label>
      <div className="chips">
        {TYPE_CHIPS.map(([key, label]) => (
          <button key={key} className="chip" aria-pressed={filter.type === key} onClick={() => setFilter({ ...filter, type: key, categoryIds: [] })}>{label}</button>
        ))}
        <button className="chip filter-chip" aria-pressed={count > 0} onClick={() => setFiltering(true)}>
          <SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" /> Filter{count > 0 ? ` · ${count}` : ''}
        </button>
        {!byRange && <button className="chip" aria-pressed={allMonths} onClick={() => setAllMonths(!allMonths)}>Alle Monate</button>}
      </div>

      {selecting && filtered.length > 0 && (
        <div className="select-tools">
          <span className="row-sub">{filtered.length} in der Liste</span>
          <button className="link-btn" onClick={() => setChosen(allChosen ? new Set([...chosen].filter((id) => !filtered.some((e) => e.id === id))) : new Set([...chosen, ...filtered.map((e) => e.id)]))}>
            {allChosen ? 'Alle abwählen' : 'Alle gefilterten auswählen'}
          </button>
        </div>
      )}

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
            {rows.map((entry) => (
              <EntryRow
                key={entry.id} entry={entry} category={byId.get(entry.categoryId)} settled={isParentsExpense(entry) && settled.has(entry.id)} labels={labelsById}
                selecting={selecting} checked={chosen.has(entry.id)} onToggle={() => toggle(entry.id)}
              />
            ))}
          </div>
        </section>
      ))}
      {days.length > 0 && <p className="section-foot">{selecting ? 'Tippe Einträge an, um sie auszuwählen. Die Summe steht unten.' : 'Zum Bearbeiten oder Löschen nach links wischen. „Auswählen“ rechnet Einträge zusammen.'}</p>}

      {selecting && (
        <div className="select-bar" role="region" aria-label="Auswahl">
          <button className="select-sum" disabled={chosen.size === 0} onClick={() => setShowResult(true)}>
            <span className="row-sub">{chosen.size === 0 ? 'Nichts ausgewählt' : `${chosen.size} ausgewählt`}</span>
            <strong className="num">{formatEuro(summary.total > 0 || summary.income === 0 ? summary.total : summary.income)}</strong>
          </button>
          <button className="select-action" disabled={chosen.size === 0 || allLabels.length === 0} onClick={() => setLabelling(true)}><Tag size={18} aria-hidden="true" /> Label</button>
          <button className="select-action strong" disabled={chosen.size === 0} onClick={() => setShowResult(true)}>Ergebnis</button>
        </div>
      )}

      {filtering && <FilterSheet filter={filter} onChange={setFilter} onClose={() => setFiltering(false)} />}
      {showResult && <SelectionResult entries={selected} onClose={() => setShowResult(false)} />}
      {labelling && (
        <Sheet title="Label zuweisen oder entfernen" onClose={() => setLabelling(false)}>
          <div className="group">
            {allLabels.filter((l) => !l.archived).map((l) => (
              <button key={l.id} className="row" onClick={() => { setLabelling(false); labelAction(l.id) }}>
                <span className="row-main"><LabelChip label={l} /></span>
                <span className="row-sub">{selected.filter((e) => e.labels?.includes(l.id)).length} von {selected.length}</span>
              </button>
            ))}
          </div>
          <div style={{ height: 16 }} />
        </Sheet>
      )}
    </main>
  )
}
