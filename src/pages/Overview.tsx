import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { db, type Entry } from '../db'
import { useApp, useCategories, useMeta } from '../context'
import { CategoryIcon, MonthPicker, Segmented, useMonthSwipe } from '../components/ui'
import { addMonths, monthLabel, monthShort, monthRange } from '../lib/dates'
import { formatEuro, formatPercent } from '../lib/format'
import { budgetRows, expensesByCategory, monthlySeries, summarize, type CategoryShare, type MonthRow } from '../lib/stats'
import { BudgetBar, useMonthEntries } from './Budgets'

const MAX_SLICES = 8

function useDark(): boolean {
  const query = useMemo(() => matchMedia('(prefers-color-scheme: dark)'), [])
  const [dark, setDark] = useState(query.matches)
  useEffect(() => {
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [query])
  return dark
}

function chartColors(dark: boolean) {
  return dark
    ? { income: '#3987e5', expense: '#d95926', tick: 'rgba(235,235,245,.68)', grid: 'rgba(84,84,88,.5)', cursor: 'rgba(120,120,128,.2)', gap: '#1c1c1e' }
    : { income: '#2a78d6', expense: '#eb6834', tick: 'rgba(60,60,67,.72)', grid: 'rgba(60,60,67,.14)', cursor: 'rgba(120,120,128,.12)', gap: '#ffffff' }
}

const compactEuro = (cents: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(cents / 100)

interface Slice { key: string; label: string; color: string; amount: number; share: number }

/** The pie stays readable: the smallest categories share one grey slice. */
function toSlices(shares: CategoryShare[]): Slice[] {
  const slices = shares.map(({ category, amount, share }) => ({ key: category.id, label: `${category.emoji} ${category.name}`, color: category.color, amount, share }))
  if (slices.length <= MAX_SLICES) return slices
  const rest = slices.slice(MAX_SLICES - 1)
  return [...slices.slice(0, MAX_SLICES - 1), {
    key: 'rest',
    label: `Weitere (${rest.length})`,
    color: '#aeaeb2',
    amount: rest.reduce((sum, s) => sum + s.amount, 0),
    share: rest.reduce((sum, s) => sum + s.share, 0),
  }]
}

function ExpensePie({ shares, total }: { shares: CategoryShare[]; total: number }) {
  const [selected, setSelected] = useState<string | null>(null)
  const colors = chartColors(useDark())
  const slices = toSlices(shares)
  const active = slices.find((s) => s.key === selected)
  return (
    <>
      <div className="pie-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="amount"
              nameKey="label"
              innerRadius="62%"
              outerRadius="96%"
              startAngle={90}
              endAngle={-270}
              stroke={colors.gap}
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(_, index) => setSelected(slices[index].key === selected ? null : slices[index].key)}
            >
              {slices.map((s) => <Cell key={s.key} fill={s.color} fillOpacity={!selected || s.key === selected ? 1 : 0.35} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pie-center">
          <small>{active ? active.label : 'Ausgaben'}</small>
          <strong className="num">{formatEuro(active ? active.amount : total)}</strong>
          {active && <small className="num">{formatPercent(active.share)}</small>}
        </div>
      </div>
      <div style={{ margin: '10px -16px -16px' }}>
        {shares.map(({ category, amount, share }) => (
          <div className="row row-sep" key={category.id} style={{ background: 'none' }}>
            <CategoryIcon emoji={category.emoji} color={category.color} />
            <span className="row-main row-title">{category.name}</span>
            <span className="row-sub num">{formatPercent(share)}</span>
            <span className="num" style={{ fontWeight: 500 }}>{formatEuro(amount)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip num">
      <div style={{ fontWeight: 600 }}>{label && monthLabel(label)}</div>
      {payload.map((p) => (
        <div key={p.name}>
          {payload.length > 1 && <i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 5, background: p.color }} />}
          {p.name}: {formatEuro(p.value)}
        </div>
      ))}
    </div>
  )
}

function axes(colors: ReturnType<typeof chartColors>, count: number) {
  return [
    <CartesianGrid key="grid" vertical={false} stroke={colors.grid} strokeWidth={0.5} />,
    <XAxis key="x" dataKey="month" tickFormatter={monthShort} axisLine={false} tickLine={false} interval={0} tick={{ fill: colors.tick, fontSize: count > 6 ? 10 : 12 }} />,
    <YAxis key="y" tickFormatter={compactEuro} axisLine={false} tickLine={false} width={40} tick={{ fill: colors.tick, fontSize: 11 }} />,
  ]
}

function MonthCompare({ rows, month }: { rows: MonthRow[]; month: string }) {
  const colors = chartColors(useDark())
  return (
    <div style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: -6 }} barCategoryGap="28%">
          {axes(colors, rows.length)}
          <Tooltip content={<ChartTip />} cursor={{ fill: colors.cursor }} />
          <Bar dataKey="expense" name="Ausgaben" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => <Cell key={r.month} fill={colors.income} fillOpacity={r.month === month ? 1 : 0.45} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function IncomeVsExpense({ rows }: { rows: MonthRow[] }) {
  const colors = chartColors(useDark())
  return (
    <>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: -6 }} barCategoryGap="24%" barGap={2}>
            {axes(colors, rows.length)}
            <Tooltip content={<ChartTip />} cursor={{ fill: colors.cursor }} />
            <Bar dataKey="income" name="Einnahmen" fill={colors.income} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="expense" name="Ausgaben" fill={colors.expense} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
    status = { level: 'muted', text: 'Ohne Einnahmen in diesem Monat gibt es keine Sparquote.' }
  } else if (goal !== null) {
    const missing = Math.ceil((income * goal) / 100) - saving
    status = missing <= 0
      ? { level: 'ok', text: `✓ Sparziel von ${goal} % erreicht` }
      : { level: 'warn', text: `Noch ${formatEuro(missing)} bis zum Sparziel von ${goal} %` }
  }
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="rate">
        <span className="row-sub">Sparquote</span>
        <strong className="num">{rate === null ? '–' : formatPercent(rate)}</strong>
      </div>
      {goal !== null && rate !== null && (
        <div className="bar ok" style={{ marginTop: 8 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((rate / (goal / 100)) * 100))} aria-label="Fortschritt zum Sparziel">
          <div style={{ width: `${Math.min(100, (rate / (goal / 100)) * 100)}%` }} />
        </div>
      )}
      <div className={`status ${status.level}`}>{status.text}</div>
    </div>
  )
}

export function Overview() {
  const { month, setMonth, openEntry } = useApp()
  const categories = useCategories()
  const entries = useMonthEntries(month)
  const goal = useMeta<number | null>('savingsGoal', null)
  const [span, setSpan] = useState<'6' | '12'>('6')
  const swipe = useMonthSwipe(month, setMonth)

  const history = useLiveQuery(() => {
    const [from] = monthRange(addMonths(month, -11))
    const [, to] = monthRange(month)
    return db.entries.where('date').between(from, to, true, true).toArray()
  }, [month], [] as Entry[])

  const summary = summarize(entries)
  const shares = expensesByCategory(entries, categories)
  const budgets = budgetRows(entries, categories)
  const rows = monthlySeries(history, month, Number(span))

  return (
    <main className="page" {...swipe}>
      <h1 className="page-title">Übersicht</h1>
      <MonthPicker month={month} onChange={setMonth} />

      <div className="kpis">
        <div className="kpi"><label>Einnahmen</label><strong className="num">{formatEuro(summary.income)}</strong></div>
        <div className="kpi"><label>Ausgaben</label><strong className="num">{formatEuro(summary.expense)}</strong></div>
        <div className="kpi"><label>Sparen</label><strong className="num">{formatEuro(summary.saving)}</strong></div>
        <div className="kpi"><label>Rest</label><strong className={summary.rest < 0 ? 'num danger' : 'num'}>{formatEuro(summary.rest)}</strong></div>
      </div>

      <SavingsCard saving={summary.saving} income={summary.income} rate={summary.savingsRate} goal={goal} />

      <h2 className="section-title strong">Ausgaben nach Kategorie</h2>
      <div className="card">
        {shares.length > 0
          ? <ExpensePie key={month} shares={shares} total={summary.expense} />
          : (
            <div className="empty" style={{ padding: '24px 8px' }}>
              <b>Noch keine Ausgaben</b>
              <button className="link-btn" onClick={() => openEntry()}>Jetzt eintragen</button>
            </div>
          )}
      </div>

      {budgets.length > 0 && (
        <>
          <h2 className="section-title strong">Budgets</h2>
          <div className="group">
            {budgets.map((row) => <BudgetBar key={row.category.id} row={row} />)}
          </div>
        </>
      )}

      <h2 className="section-title strong">Monate im Vergleich</h2>
      <div style={{ marginBottom: 10 }}>
        <Segmented value={span} options={[['6', '6 Monate'], ['12', '12 Monate']]} onChange={setSpan} />
      </div>
      <div className="card">
        <div className="row-sub" style={{ marginBottom: 6 }}>Ausgaben pro Monat</div>
        <MonthCompare rows={rows} month={month} />
      </div>

      <h2 className="section-title strong">Einnahmen und Ausgaben</h2>
      <div className="card">
        <IncomeVsExpense rows={rows} />
      </div>
    </main>
  )
}
