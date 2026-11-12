import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileText, Sparkles } from 'lucide-react'
import { db, type Entry, type EntryType } from '../db'
import { useApp, useCategories, useGroups, useMeta, useRangeEntries } from '../context'
import { CategoryIcon } from '../components/CategoryIcon'
import { Icon } from '../components/Icon'
import { HideParentsRow } from '../components/ParentsCard'
import { Chevron, Collapse, CountUp, PageHead, Segmented, Trend, useSticky } from '../components/ui'
import { addMonths, monthLabel, monthOf, today } from '../lib/dates'
import { formatEuro, formatPercent } from '../lib/format'
import { change, compareTree, inPeriod, monthlySeries, monthPeriod, summarize, withoutParents, yearHighlights, yearPeriod, type CompareNode, type MonthSummary } from '../lib/stats'
import { IncomeVsExpense } from './Overview'
import { StatementView } from '../components/StatementView'
import type { StatementPeriod } from '../lib/statement'
import { hasWrapped } from '../lib/wrapped'

const TYPES: [EntryType, string][] = [['expense', 'Ausgaben'], ['income', 'Einnahmen'], ['saving', 'Sparen']]
const MONTH_NAMES = (month: string) => monthLabel(month).split(' ')[0]

function Diff({ a, b }: { a: number; b: number }) {
  const d = a - b
  const ratio = change(a, b)
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  return (
    <span className="diff num">
      {sign}{formatEuro(Math.abs(d))}
      {ratio !== null && ` · ${sign}${Math.round(Math.abs(ratio) * 100)} %`}
      {ratio === null && a > 0 && ' · neu'}
    </span>
  )
}

function CompareRow({ node, depth, open, onToggle }: { node: CompareNode; depth: number; open?: boolean; onToggle?: () => void }) {
  const content = (
    <>
      <span className="cmp-name">
        {node.category ? <CategoryIcon category={node.category} size={depth ? 24 : 28} /> : <span className="dot" style={{ background: node.color }} />}
        <span className="row-title">{node.label}</span>
      </span>
      <span className="num cmp-a">{formatEuro(node.a)}</span>
      <span className="num cmp-b">{formatEuro(node.b)}</span>
      <span className="cmp-diff"><Diff a={node.a} b={node.b} />{onToggle && <Chevron open={!!open} />}</span>
    </>
  )
  return onToggle
    ? <button className={`cmp-row depth-${depth}`} aria-expanded={open} onClick={onToggle}>{content}</button>
    : <div className={`cmp-row depth-${depth}`}>{content}</div>
}

function CompareList({ nodes, labelA, labelB }: { nodes: CompareNode[]; labelA: string; labelB: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const groups = nodes.filter((n) => n.children.length > 0)
  const allOpen = groups.length > 0 && groups.every((n) => open.has(n.key))
  const toggle = (key: string) => {
    const next = new Set(open)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpen(next)
  }
  if (nodes.length === 0) return <div className="empty" style={{ padding: '24px 8px' }}><b>Keine Einträge</b>In beiden Zeiträumen gibt es hier nichts.</div>
  return (
    <>
      <div className="cmp-head">
        <span>{groups.length > 0 && <button className="link-btn" style={{ padding: 0 }} onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}>{allOpen ? 'Alle zuklappen' : 'Alle aufklappen'}</button>}</span>
        <span>{labelA}</span>
        <span>{labelB}</span>
      </div>
      <div className="card flush">
        {nodes.map((node) => (
          <div key={node.key} className="cmp-block">
            {node.children.length > 0
              ? (
                <>
                  <CompareRow node={node} depth={0} open={open.has(node.key)} onToggle={() => toggle(node.key)} />
                  <Collapse open={open.has(node.key)}>
                    <div className="cmp-children">{node.children.map((child) => <CompareRow key={child.key} node={child} depth={1} />)}</div>
                  </Collapse>
                </>
              )
              : <CompareRow node={node} depth={0} />}
          </div>
        ))}
      </div>
    </>
  )
}

function KpiTile({ label, value, previous, percent }: { label: string; value: number; previous: number; percent?: boolean }) {
  return (
    <div className="kpi">
      <label>{label}</label>
      {percent ? <strong className="num">{formatPercent(value)}</strong> : <strong><CountUp cents={value} /></strong>}
      {previous === 0 ? <span className="trend">kein Vergleich</span> : <Trend current={value} previous={previous} />}
    </div>
  )
}

const rate = (s: MonthSummary) => s.savingsRate ?? 0

function YearView({ hide }: { hide: boolean }) {
  const categories = useCategories()
  const groups = useGroups()
  const thisYear = Number(today().slice(0, 4))
  const [year, setYear] = useSticky('analysis-year', thisYear)
  const [other, setOther] = useSticky('analysis-other', thisYear - 1)
  const [type, setType] = useSticky<EntryType>('analysis-type-year', 'expense')
  const first = useLiveQuery(() => db.entries.orderBy('date').first(), [])
  const firstYear = Math.min(Number(first?.date.slice(0, 4) ?? thisYear), thisYear - 1)
  const years = Array.from({ length: thisYear - firstYear + 2 }, (_, i) => thisYear + 1 - i)

  const lo = Math.min(year, other)
  const hi = Math.max(year, other)
  const loaded = withoutParents(useRangeEntries(`${lo}-01-01`, `${hi}-12-31`), hide)
  const a = inPeriod(loaded, yearPeriod(year))
  const b = inPeriod(loaded, yearPeriod(other))
  const sa = summarize(a)
  const sb = summarize(b)
  const rows = monthlySeries(a, `${year}-12`, 12)
  const expenseTree = compareTree('expense', a, b, categories, groups)
  const highlights = yearHighlights(rows, expenseTree, MONTH_NAMES, formatEuro)

  return (
    <>
      <div className="pickers">
        <label className="picker">
          <span>Jahr</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Jahr">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </label>
        <span className="vs">vs.</span>
        <label className="picker">
          <span>Vergleich</span>
          <select value={other} onChange={(e) => setOther(Number(e.target.value))} aria-label="Vergleichsjahr">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </label>
      </div>

      <div className="kpis">
        <KpiTile label="Einnahmen" value={sa.income} previous={sb.income} />
        <KpiTile label="Ausgaben" value={sa.expense} previous={sb.expense} />
        <KpiTile label="Gespart" value={sa.saving} previous={sb.saving} />
        <KpiTile label="Ø Sparquote" value={rate(sa)} previous={rate(sb)} percent />
      </div>
      <p className="section-foot">Pfeile: Veränderung gegenüber {other}. Die Sparquote ist das Gesparte geteilt durch die Einnahmen des Jahres.</p>

      <h2 className="section-title strong">Monate {year}</h2>
      <div className="card"><IncomeVsExpense rows={rows} /></div>

      {highlights.length > 0 && (
        <>
          <h2 className="section-title strong">Auffällig</h2>
          <div className="card highlights">
            {highlights.map((h) => (
              <div key={h.label} className="highlight">
                <span className="row-sub">{h.label}</span>
                <b>{h.value}</b>
                {h.detail && <span className="row-sub num">{h.detail}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title strong">Kategorien</h2>
      <Segmented value={type} options={TYPES} onChange={setType} />
      <div style={{ height: 10 }} />
      <CompareList key={type} nodes={compareTree(type, a, b, categories, groups)} labelA={String(year)} labelB={String(other)} />
    </>
  )
}

function MonthStep({ month, onChange, label }: { month: string; onChange: (month: string) => void; label: string }) {
  return (
    <div className="picker step">
      <span>{label}</span>
      <div>
        <button className="icon-btn small" aria-label={`${label}: vorheriger Monat`} onClick={() => onChange(addMonths(month, -1))}><Icon name="left" size={18} /></button>
        <b>{monthLabel(month).replace(/^(\w{3})\w*/, '$1')}</b>
        <button className="icon-btn small" aria-label={`${label}: nächster Monat`} onClick={() => onChange(addMonths(month, 1))}><Icon name="right" size={18} /></button>
      </div>
    </div>
  )
}

function MonthView({ hide }: { hide: boolean }) {
  const categories = useCategories()
  const groups = useGroups()
  const now = monthOf(today())
  const [ma, setA] = useSticky('analysis-month-a', now)
  const [mb, setB] = useSticky('analysis-month-b', addMonths(now, -1))
  const [type, setType] = useSticky<EntryType>('analysis-type-month', 'expense')
  const lo = ma < mb ? ma : mb
  const hi = ma < mb ? mb : ma
  const loaded = withoutParents(useRangeEntries(monthPeriod(lo).from, monthPeriod(hi).to), hide)
  const a = inPeriod(loaded, monthPeriod(ma))
  const b = inPeriod(loaded, monthPeriod(mb))
  const sa = summarize(a)
  const sb = summarize(b)
  const short = (m: string) => monthLabel(m).replace(/^(\w{3})\w*/, '$1')

  const kpis: [string, number, number, boolean?][] = [
    ['Einnahmen', sa.income, sb.income],
    ['Ausgaben', sa.expense, sb.expense],
    ['Gespart', sa.saving, sb.saving],
    ['Rest', sa.rest, sb.rest],
  ]

  return (
    <>
      <div className="pickers">
        <MonthStep month={ma} onChange={setA} label="Monat" />
        <span className="vs">vs.</span>
        <MonthStep month={mb} onChange={setB} label="Vergleich" />
      </div>

      <div className="cmp-head">
        <span />
        <span>{short(ma)}</span>
        <span>{short(mb)}</span>
      </div>
      <div className="card flush">
        {kpis.map(([label, x, y]) => (
          <div key={label} className="cmp-row depth-0">
            <span className="cmp-name"><span className="row-title">{label}</span></span>
            <span className="num cmp-a">{formatEuro(x)}</span>
            <span className="num cmp-b">{formatEuro(y)}</span>
            <span className="cmp-diff"><Diff a={x} b={y} /></span>
          </div>
        ))}
        <div className="cmp-row depth-0">
          <span className="cmp-name"><span className="row-title">Sparquote</span></span>
          <span className="num cmp-a">{sa.savingsRate === null ? '–' : formatPercent(sa.savingsRate)}</span>
          <span className="num cmp-b">{sb.savingsRate === null ? '–' : formatPercent(sb.savingsRate)}</span>
          <span className="cmp-diff"><span className="diff num">{sa.savingsRate !== null && sb.savingsRate !== null ? `${sa.savingsRate > sb.savingsRate ? '+' : sa.savingsRate < sb.savingsRate ? '−' : '±'}${formatPercent(Math.abs(sa.savingsRate - sb.savingsRate)).replace(' %', ' Prozentpunkte')}` : ''}</span></span>
        </div>
      </div>

      <h2 className="section-title strong">Kategorien</h2>
      <Segmented value={type} options={TYPES} onChange={setType} />
      <div style={{ height: 10 }} />
      <CompareList key={type} nodes={compareTree(type, a, b, categories, groups)} labelA={short(ma)} labelB={short(mb)} />
    </>
  )
}

/** All past reviews: months with enough entries and the years */
function Reviews() {
  const { openWrapped } = useApp()
  const entries = useLiveQuery(() => db.entries.toArray(), [], [] as Entry[])
  const now = today()
  const months = Array.from({ length: 24 }, (_, i) => addMonths(monthOf(now), -1 - i)).filter((m) => hasWrapped(entries, { kind: 'month', key: m }))
  const thisYear = Number(now.slice(0, 4))
  const years = Array.from({ length: 5 }, (_, i) => String(thisYear - 1 - i)).filter((y) => hasWrapped(entries, { kind: 'year', key: y }))
  if (months.length === 0 && years.length === 0) return null
  return (
    <>
      <h2 className="section-title strong">Rückblicke</h2>
      <div className="review-strip">
        {years.map((y) => <button key={y} className="review-tile year" onClick={() => openWrapped(y)}><Sparkles size={16} aria-hidden="true" /><b>{y}</b><span>Jahr</span></button>)}
        {months.map((m) => <button key={m} className="review-tile" onClick={() => openWrapped(m)}><b>{monthLabel(m).split(' ')[0]}</b><span>{m.slice(0, 4)}</span></button>)}
      </div>
    </>
  )
}

export function Analysis() {
  const [view, setView] = useSticky<'statement' | 'compare'>('analysis-view', 'statement')
  const [mode, setMode] = useSticky<'year' | 'month'>('analysis-mode', 'year')
  const hide = useMeta('hideParents', false)
  const { openReport, statementTarget, clearStatementTarget } = useApp()
  const [target, setTarget] = useState<StatementPeriod | undefined>(undefined)
  useEffect(() => {
    if (!statementTarget) return
    setTarget({ kind: statementTarget.length === 4 ? 'year' : 'month', key: statementTarget })
    setView('statement')
    clearStatementTarget()
  }, [statementTarget, clearStatementTarget, setView])
  return (
    <main className="page">
      <PageHead title="Auswertung" />
      <Segmented value={view} options={[['statement', 'Abrechnung'], ['compare', 'Vergleich']]} onChange={setView} />
      <div className="group" style={{ margin: '10px 0 12px' }}><HideParentsRow hide={hide} /></div>
      {view === 'statement'
        ? (
          <>
            <StatementView key={target ? `${target.kind}:${target.key}` : 'now'} initial={target} />
            <Reviews />
          </>
        )
        : (
          <>
            <Segmented value={mode} options={[['year', 'Jahr'], ['month', 'Monat']]} onChange={setMode} />
            <div style={{ height: 10 }} />
            {mode === 'year' ? <YearView hide={hide} /> : <MonthView hide={hide} />}
          </>
        )}
      <div className="group" style={{ marginTop: 20 }}>
        <button className="row tint" onClick={() => openReport()}>
          <FileText size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className="row-main">Monatsabrechnung als PDF</span>
        </button>
      </div>
    </main>
  )
}
