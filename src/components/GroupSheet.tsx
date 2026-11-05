import { useMemo, useState } from 'react'
import type { Category, Entry } from '../db'
import { useApp } from '../context'
import { formatDate, monthLabel } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { sumByCategory, type Segment } from '../lib/stats'
import { CategoryIcon } from './CategoryIcon'
import { Chevron, Collapse, Sheet, Trend } from './ui'

export interface DetailPeriods {
  mode: 'month' | 'year'
  /** Entries of the shown month or year */
  current: Entry[]
  /** The month or year before, for the arrow */
  previous: Entry[]
  previousLabel: string
  /** Month view: the whole year of the month, for the year sum */
  year: Entry[]
  yearLabel: string
}

function CategoryBlock({ category, periods, open, onToggle }: { category: Category; periods: DetailPeriods; open: boolean; onToggle: () => void }) {
  const { openEntry } = useApp()
  const current = sumByCategory(periods.current).get(category.id) ?? 0
  const previous = sumByCategory(periods.previous).get(category.id) ?? 0
  const year = sumByCategory(periods.year).get(category.id) ?? 0
  const entries = periods.current
    .filter((e) => e.type === 'expense' && e.categoryId === category.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

  return (
    <div className="detail-block">
      <button className="detail-head" aria-expanded={open} onClick={onToggle}>
        <CategoryIcon category={category} />
        <span className="row-main">
          <span className="row-title" style={{ display: 'block' }}>{category.name}</span>
          <span className="row-sub" style={{ display: 'block' }}>
            {periods.mode === 'month' ? `${periods.yearLabel}: ${formatEuro(year)}` : `Ø ${formatEuro(Math.round(current / 12))} pro Monat`}
          </span>
        </span>
        <span className="detail-sum">
          <span className="num">{formatEuro(current)}</span>
          <Trend current={current} previous={previous} label={`zu ${periods.previousLabel}`} />
        </span>
        <Chevron open={open} />
      </button>
      <Collapse open={open}>
        <div className="detail-entries">
          {entries.length === 0 && <div className="row-sub detail-empty">Keine Ausgaben in diesem Zeitraum</div>}
          {entries.map((e) => (
            <button key={e.id} className="detail-entry" onClick={() => openEntry(e)}>
              <span className="row-sub num">{formatDate(e.date).slice(0, 6)}</span>
              <span className="row-main row-title">{e.merchant || e.note || category.name}</span>
              <span className="num">{formatEuro(e.amount)}</span>
            </button>
          ))}
        </div>
      </Collapse>
    </div>
  )
}

/** Categories of one overcategory with their sums, each one opens to its single expenses. */
export function GroupSheet({ segment, periods, title, onClose }: { segment: Segment; periods: DetailPeriods; title: string; onClose: () => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(segment.categories.length === 1 ? [segment.categories[0].id] : []))
  const allOpen = open.size === segment.categories.length
  const current = sumByCategory(periods.current)
  const year = sumByCategory(periods.year)
  const sorted = useMemo(
    () => [...segment.categories].sort((a, b) => (current.get(b.id) ?? 0) - (current.get(a.id) ?? 0)),
    [segment.categories, current],
  )
  const total = segment.categories.reduce((sum, c) => sum + (current.get(c.id) ?? 0), 0)
  const yearTotal = segment.categories.reduce((sum, c) => sum + (year.get(c.id) ?? 0), 0)

  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }

  return (
    <Sheet title={segment.label} onClose={onClose} full>
      <div className="detail-bar">
        <span className="row-sub">{title}</span>
        <button className="link-btn" onClick={() => setOpen(allOpen ? new Set() : new Set(segment.categories.map((c) => c.id)))}>
          {allOpen ? 'Alle zuklappen' : 'Alle aufklappen'}
        </button>
      </div>
      <div className="card flush">
        {sorted.map((c) => <CategoryBlock key={c.id} category={c} periods={periods} open={open.has(c.id)} onToggle={() => toggle(c.id)} />)}
      </div>
      <div className="card detail-total">
        <span>Summe {segment.label}</span>
        <strong className="num">{formatEuro(total)}</strong>
        {periods.mode === 'month' && <span className="row-sub num">{periods.yearLabel}: {formatEuro(yearTotal)}</span>}
      </div>
    </Sheet>
  )
}

export const previousMonthLabel = (month: string) => monthLabel(month).split(' ')[0]
