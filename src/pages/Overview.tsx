import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Archive, BellRing, FileText, X } from 'lucide-react'
import { db, PARENT_CATEGORIES, setMeta, type Entry } from '../db'
import { useApp, useCategories, useGroups, useMeta, useRangeEntries } from '../context'
import { CategoryIcon } from '../components/CategoryIcon'
import { GroupSheet, previousMonthLabel, type DetailPeriods } from '../components/GroupSheet'
import { HideParentsRow, ParentsCard } from '../components/ParentsCard'
import { Ring } from '../components/Ring'
import { CountUp, MonthPicker, Segmented, Trend, useMonthSwipe, useSticky, YearPicker } from '../components/ui'
import { useBackupExport } from '../components/BackupExport'
import { REPORT_DONE } from '../components/ReportSheet'
import { backupState, parentsReportDue } from '../lib/reminders'
import { addMonths, formatTime, monthLabel, monthShort, today } from '../lib/dates'
import { formatEuro, formatPercent } from '../lib/format'
import { reminders } from '../lib/subscriptions'
import { budgetRows, expenseSegments, inPeriod, monthlySeries, monthPeriod, summarize, withoutParents, yearPeriod, type MonthRow, type Segment } from '../lib/stats'
import { useTheme } from '../lib/theme'
import { BudgetBar } from './Budgets'

export function useDark(): boolean {
  const hud = useTheme() === 'hud'
  const query = useMemo(() => matchMedia('(prefers-color-scheme: dark)'), [])
  const [dark, setDark] = useState(query.matches)
  useEffect(() => {
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [query])
  return dark || hud
}

export function useChartColors() {
  const hud = useTheme() === 'hud'
  const dark = useDark()
  if (hud) return { income: '#38d9f5', expense: '#f2a541', tick: 'rgba(140,225,245,.7)', grid: 'rgba(56,217,245,.16)', cursor: 'rgba(56,217,245,.1)' }
  return dark
    ? { income: '#4a76c8', expense: '#c86f30', tick: 'rgba(235,235,245,.6)', grid: 'rgba(84,84,88,.35)', cursor: 'rgba(120,120,128,.18)' }
    : { income: '#4a76c8', expense: '#c86f30', tick: 'rgba(60,60,67,.6)', grid: 'rgba(60,60,67,.1)', cursor: 'rgba(120,120,128,.1)' }
}

const compactEuro = (cents: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(cents / 100)

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip num">
      <div style={{ fontWeight: 600 }}>{label && monthLabel(label)}</div>
      {payload.map((p) => (
        <div key={p.name}>
          <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 5, background: p.color }} />
          {p.name}: {formatEuro(p.value)}
        </div>
      ))}
    </div>
  )
}

export function IncomeVsExpense({ rows, height = 200 }: { rows: MonthRow[]; height?: number }) {
  const colors = useChartColors()
  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%" barGap={2}>
            <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={0.5} />
            <XAxis dataKey="month" tickFormatter={monthShort} axisLine={false} tickLine={false} interval={0} tick={{ fill: colors.tick, fontSize: rows.length > 6 ? 10 : 12 }} />
            <YAxis tickFormatter={compactEuro} axisLine={false} tickLine={false} width={46} tick={{ fill: colors.tick, fontSize: 11 }} />
            <Tooltip content={<ChartTip />} cursor={{ fill: colors.cursor }} />
            <Bar dataKey="income" name="Einnahmen" fill={colors.income} radius={[4, 4, 0, 0]} animationDuration={500} />
            <Bar dataKey="expense" name="Ausgaben" fill={colors.expense} radius={[4, 4, 0, 0]} animationDuration={500} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend">
        <span><i style={{ background: colors.income }} />Einnahmen</span>
        <span><i style={{ background: colors.expense }} />Ausgaben</span>
      </div>
    </>
  )
}

function SavingsCard({ saving, income, rate, goal }: { saving: number; income: number; rate: number | null; goal: number | null }) {
  let status = { level: 'muted', text: 'Lege in den Einstellungen ein Sparziel fest.' }
  if (rate === null) {
    status = { level: 'muted', text: 'Ohne Einnahmen gibt es keine Sparquote.' }
  } else if (goal !== null) {
    const missing = Math.ceil((income * goal) / 100) - saving
    status = missing <= 0
      ? { level: 'ok', text: `✓ Sparziel von ${goal} % erreicht` }
      : { level: 'muted', text: `Noch ${formatEuro(missing)} bis zum Sparziel von ${goal} %` }
  }
  return (
    <div className="card">
      <div className="rate">
        <span className="row-sub">Sparquote</span>
        <strong className="num">{rate === null ? '–' : formatPercent(rate)}</strong>
      </div>
      {goal !== null && rate !== null && (
        <div className="bar ok" style={{ marginTop: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((rate / (goal / 100)) * 100))} aria-label="Fortschritt zum Sparziel">
          <div style={{ width: `${Math.min(100, (rate / (goal / 100)) * 100)}%` }} />
        </div>
      )}
      <div className={`status ${status.level}`}>{status.text}</div>
    </div>
  )
}

function Reminders() {
  const { openSettings } = useApp()
  const lead = useMeta('reminderDays', 7)
  const dismissed = useMeta<string[]>('dismissedReminders', [])
  const subscriptions = useLiveQuery(() => db.recurring.filter((r) => !!r.subscription).toArray(), [], [])
  const due = reminders(subscriptions, lead).filter((r) => !dismissed.includes(r.key))
  if (due.length === 0) return null
  return (
    <div className="card reminder">
      <BellRing size={20} strokeWidth={1.8} aria-hidden="true" />
      <button className="row-main" style={{ textAlign: 'left' }} onClick={() => openSettings('subscriptions')}>
        <b>Abos</b>
        {due.map((r) => <span key={r.key} className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>{r.text}</span>)}
      </button>
      <button className="icon-btn" aria-label="Erinnerung ausblenden" onClick={() => setMeta('dismissedReminders', [...dismissed, ...due.map((r) => r.key)].slice(-50))}>
        <X size={18} />
      </button>
    </div>
  )
}

/** Monthly backup reminder; between reminders a quiet hint once the last backup is 30 days old. */
function BackupHint() {
  const last = useMeta<number | null>('lastBackupAt', null)
  const enabled = useMeta('backupReminder', true)
  const day = useMeta('backupDay', 1)
  const dismissed = useMeta<string | null>('backupReminderDismissed', null)
  const backup = useBackupExport()
  const state = backupState(today(), last, { enabled, day, dismissed })
  if (!state.reminder && !state.stale) return null
  const since = last === null ? 'Noch kein Backup' : `Letztes Backup: ${formatTime(last)}`
  return (
    <div className={state.reminder ? 'card reminder' : 'card hint'}>
      {state.reminder && <Archive size={20} strokeWidth={1.8} aria-hidden="true" />}
      <button className="row-main" style={{ textAlign: 'left' }} disabled={backup.busy} onClick={backup.run}>
        <b>{state.reminder ? 'Zeit für dein Backup' : last === null ? 'Noch kein Backup' : `Letztes Backup vor ${state.days} Tagen`}</b>
        <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>
          {backup.busy ? 'Backup wird erstellt …' : state.reminder ? `${since}. Antippen sichert alles samt Fotos, verschlüsselt mit deinem App-Code.` : 'Deine Daten und Fotos liegen nur auf diesem iPhone.'}
        </span>
      </button>
      {state.reminder
        ? <button className="icon-btn" aria-label="Erinnerung für diesen Monat ausblenden" onClick={() => setMeta('backupReminderDismissed', today().slice(0, 7))}><X size={18} /></button>
        : <button className="secondary-btn small" disabled={backup.busy} onClick={backup.run}>Sichern</button>}
    </div>
  )
}

function ParentsReportHint({ parents }: { parents: Entry[] }) {
  const { openReport } = useApp()
  const enabled = useMeta('parentsReminder', true)
  const done = useMeta<string[]>(REPORT_DONE, [])
  const month = parentsReportDue(today(), parents, done, enabled)
  if (!month) return null
  return (
    <div className="card reminder">
      <FileText size={20} strokeWidth={1.8} aria-hidden="true" />
      <button className="row-main" style={{ textAlign: 'left' }} onClick={() => openReport({ month, kind: 'parents' })}>
        <b>Abrechnung Eltern für {monthLabel(month).split(' ')[0]} erstellen?</b>
        <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>PDF mit allen Posten und Belegen zum Teilen</span>
      </button>
      <button className="icon-btn" aria-label="Erinnerung ausblenden" onClick={() => setMeta(REPORT_DONE, [...done, month].slice(-36))}><X size={18} /></button>
    </div>
  )
}

export function Overview() {
  const { month, setMonth, openEntry } = useApp()
  const categories = useCategories()
  const groups = useGroups()
  const goal = useMeta<number | null>('savingsGoal', null)
  const hide = useMeta('hideParents', false)
  const [mode, setMode] = useSticky<'month' | 'year'>('overview-mode', 'month')
  const [year, setYear] = useSticky('overview-year', Number(today().slice(0, 4)))
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Segment | null>(null)
  const swipe = useMonthSwipe(month, setMonth)

  const shownYear = mode === 'month' ? Number(month.slice(0, 4)) : year
  const current = mode === 'month' ? monthPeriod(month) : yearPeriod(year)
  const previous = mode === 'month' ? monthPeriod(addMonths(month, -1)) : yearPeriod(year - 1)
  const whole = yearPeriod(shownYear)
  const chartFrom = mode === 'month' ? monthPeriod(addMonths(month, -5)).from : whole.from
  const from = [previous.from, chartFrom, whole.from].sort()[0]
  const loaded = useRangeEntries(from, whole.to > current.to ? whole.to : current.to)
  const parents = useLiveQuery(() => db.entries.where('categoryId').anyOf(PARENT_CATEGORIES).toArray(), [], [] as Entry[])

  const all = withoutParents(loaded, hide)
  const entries = inPeriod(all, current)
  const summary = summarize(entries)
  const prevSummary = summarize(inPeriod(all, previous))
  const segments = expenseSegments(entries, categories, groups)
  const budgets = budgetRows(entries, categories)
  const rows = mode === 'month'
    ? monthlySeries(all, month, 6)
    : monthlySeries(inPeriod(all, whole), `${year}-12`, 12)
  const previousLabel = mode === 'month' ? previousMonthLabel(addMonths(month, -1)) : String(year - 1)
  const title = mode === 'month' ? 'Ausgaben im Monat' : `Ausgaben ${year}`

  const periods: DetailPeriods = {
    mode,
    current: entries,
    previous: inPeriod(all, previous),
    previousLabel,
    year: inPeriod(all, whole),
    yearLabel: `Jahr ${shownYear}`,
  }

  useEffect(() => setSelected(null), [mode, month, year])

  return (
    <main className="page" {...(mode === 'month' ? swipe : {})}>
      <h1 className="page-title">Übersicht</h1>
      <Segmented value={mode} options={[['month', 'Monat'], ['year', 'Jahr']]} onChange={setMode} />
      <div style={{ height: 6 }} />
      {mode === 'month' ? <MonthPicker month={month} onChange={setMonth} /> : <YearPicker year={year} onChange={setYear} />}

      <div className="card hero">
        <span className="row-sub">{mode === 'month' ? 'Rest im Monat' : `Rest im Jahr ${year}`}</span>
        <CountUp cents={summary.rest} className={summary.rest < 0 ? 'hero-num over' : 'hero-num'} />
        <div className="hero-stats">
          <div><span>Einnahmen</span><b className="num">{formatEuro(summary.income)}</b><Trend current={summary.income} previous={prevSummary.income} /></div>
          <div><span>Ausgaben</span><b className="num">{formatEuro(summary.expense)}</b><Trend current={summary.expense} previous={prevSummary.expense} /></div>
          <div><span>Gespart</span><b className="num saved">{formatEuro(summary.saving)}</b><Trend current={summary.saving} previous={prevSummary.saving} /></div>
        </div>
      </div>

      <div className="stack">
        <SavingsCard saving={summary.saving} income={summary.income} rate={summary.savingsRate} goal={goal} />
        <Reminders />
        <BackupHint />
        <ParentsReportHint parents={parents} />
        <ParentsCard entries={parents} />
        <div className="group"><HideParentsRow hide={hide} /></div>
      </div>

      <h2 className="section-title strong">Ausgaben nach Bereichen</h2>
      <div className="card">
        {segments.length > 0
          ? (
            <>
              <Ring key={`${mode}-${month}-${year}`} segments={segments} total={summary.expense} title={title} selected={selected} onSelect={setSelected} />
              {selected && (
                <button className="link-btn ring-detail" onClick={() => setDetail(segments.find((s) => s.key === selected) ?? null)}>
                  Details zu {segments.find((s) => s.key === selected)?.label} ›
                </button>
              )}
              <div className="legend-list">
                {segments.map((s) => (
                  <button key={s.key} className="legend-row" aria-pressed={s.key === selected} onClick={() => setDetail(s)}>
                    {s.group ? <span className="dot" style={{ background: s.color }} /> : <CategoryIcon category={s.categories[0]} size={26} />}
                    <span className="row-main row-title">{s.label}</span>
                    <span className="row-sub num">{formatPercent(s.share)}</span>
                    <span className="num legend-amount">{formatEuro(s.amount)}</span>
                    <span className="chevron" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </>
          )
          : (
            <div className="empty" style={{ padding: '24px 8px' }}>
              <b>Noch keine Ausgaben</b>
              <button className="link-btn" onClick={() => openEntry()}>Jetzt eintragen</button>
            </div>
          )}
      </div>

      {mode === 'month' && budgets.length > 0 && (
        <>
          <h2 className="section-title strong">Budgets</h2>
          <div className="group">
            {budgets.map((row) => <BudgetBar key={row.category.id} row={row} />)}
          </div>
        </>
      )}

      <h2 className="section-title strong">{mode === 'month' ? 'Letzte 6 Monate' : `Monate ${year}`}</h2>
      <div className="card">
        <IncomeVsExpense rows={rows} />
      </div>

      {detail && <GroupSheet segment={detail} periods={periods} title={mode === 'month' ? monthLabel(month) : `Jahr ${year}`} onClose={() => setDetail(null)} />}
    </main>
  )
}
