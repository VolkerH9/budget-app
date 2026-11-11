import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Target } from 'lucide-react'
import { db, newId, type Category, type Entry, type Goal, type Group, type PeriodBudget } from '../db'
import { useApp, useCategories, useGroups, useLabels } from '../context'
import { Icon } from '../components/Icon'
import { AmountDisplay, Keypad } from '../components/Keypad'
import { LabelGlyph } from '../components/Labels'
import { MonthPicker, Segmented, Sheet, useMonthSwipe } from '../components/ui'
import { CategoryIcon } from '../components/CategoryIcon'
import {
  goalProgress, groupCategoryIds, labelProgress, monthProgress, periodName, periodProgress,
  type GoalProgress, type Item, type Progress,
} from '../lib/budgets'
import { formatDate, monthRange, today } from '../lib/dates'
import { amountToInput, formatEuro, formatPercent, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { budgetRows, type BudgetRow } from '../lib/stats'

export function useMonthEntries(month: string): Entry[] {
  return useLiveQuery(() => {
    const [from, to] = monthRange(month)
    return db.entries.where('date').between(from, to, true, true).toArray()
  }, [month], [] as Entry[])
}

const STATUS = {
  ok: 'Im Rahmen',
  warn: 'Fast ausgeschöpft',
  over: 'Überschritten',
}

/** One budget: name, status, bar, amounts and, from day 5 on, the forecast */
export function ProgressRow({ icon, name, sub, p, onClick }: { icon: ReactNode; name: string; sub?: string; p: Progress; onClick?: () => void }) {
  const content = (
    <>
      <div className="budget-head">
        <span className="budget-name">
          {icon}
          <span>{name}{sub && <small className="budget-sub">{sub}</small>}</span>
        </span>
        <span className={`status ${p.level}`} style={{ marginTop: 0 }}>{STATUS[p.level]}</span>
      </div>
      <div className={`bar ${p.level}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(p.ratio * 100))} aria-label={name}>
        <div style={{ width: `${Math.min(100, p.ratio * 100)}%` }} />
      </div>
      <div className="budget-foot num">
        <span>{formatEuro(p.spent)} von {formatEuro(p.budget)} · {formatPercent(p.ratio)}</span>
        <span className={p.rest < 0 ? 'danger' : undefined}>{p.rest < 0 ? `${formatEuro(-p.rest)} drüber` : `${formatEuro(p.rest)} übrig`}</span>
      </div>
      {p.forecast && <div className={`forecast ${p.forecast.startsWith('Bei diesem') ? 'warn' : ''}`}>{p.forecast}</div>}
    </>
  )
  return onClick
    ? <button className="budget" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={onClick}>{content}</button>
    : <div className="budget">{content}</div>
}

export function BudgetBar({ row, onClick }: { row: BudgetRow; onClick?: () => void }) {
  const p: Progress = { spent: row.spent, budget: row.budget, ratio: row.ratio, rest: row.rest, level: row.level, forecast: null, window: null }
  return <ProgressRow icon={<CategoryIcon category={row.category} size={26} />} name={row.category.name} p={p} onClick={onClick} />
}

/** Small progress ring for savings goals */
export function GoalRing({ ratio, level, size = 64 }: { ratio: number; level: string; size?: number }) {
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  return (
    <svg className={`goal-ring ${level}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, ratio))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{Math.min(999, Math.round(ratio * 100))} %</text>
    </svg>
  )
}

const GOAL_STATUS = (g: GoalProgress) => g.reached ? 'Erreicht' : g.overdue ? 'Zieldatum verpasst' : g.onTrack ? 'Im Plan' : 'Hinter dem Plan'

export function GoalCard({ goal, p, onClick }: { goal: Goal; p: GoalProgress; onClick?: () => void }) {
  return (
    <button className="card goal-card" onClick={onClick}>
      <GoalRing ratio={p.ratio} level={p.level} />
      <span className="goal-main">
        <span className="goal-title"><span aria-hidden="true">{goal.emoji}</span> {goal.name}</span>
        <span className={`status ${p.level}`} style={{ marginTop: 0 }}>{GOAL_STATUS(p)}</span>
        <span className="goal-lines num">
          <span>Gespart <b>{formatEuro(p.saved)}</b> von {formatEuro(goal.target)}</span>
          {!p.reached && <span>Fehlt noch <b>{formatEuro(p.missing)}</b> bis {formatDate(goal.due)}</span>}
          {p.monthlyRate !== null && <span>Nötig: <b>{formatEuro(p.monthlyRate)}</b> pro Monat</span>}
        </span>
        {p.forecast && !p.reached && <span className="forecast">{p.forecast}</span>}
      </span>
    </button>
  )
}

/** Amount on the keypad, for monthly budgets of a category or overcategory */
function AmountSheet({ title, current, onSave, onClose }: { title: string; current?: number; onSave: (cents: number | undefined) => Promise<unknown>; onClose: () => void }) {
  const [text, setText] = useState(current ? amountToInput(current) : '')
  const cents = parseAmount(text)
  return (
    <Sheet title={title} onClose={onClose} action={{ label: 'Sichern', disabled: cents === null, onClick: async () => { await onSave(cents!); onClose() } }}>
      <p className="section-foot" style={{ textAlign: 'center' }}>Monatliches Budget</p>
      <AmountDisplay text={text} />
      <Keypad onChange={setText} />
      {current && (
        <button className="row center danger" style={{ marginTop: 12, borderRadius: 12 }} onClick={async () => { await onSave(undefined); onClose() }}>
          Budget entfernen
        </button>
      )}
    </Sheet>
  )
}

function PeriodSheet({ budget, onClose }: { budget?: PeriodBudget; onClose: () => void }) {
  const categories = useCategories().filter((c) => c.type === 'expense')
  const groups = useGroups().filter((g) => g.type === 'expense')
  const [target, setTarget] = useState(budget ? `${budget.scope}:${budget.targetId}` : '')
  const [period, setPeriod] = useState<PeriodBudget['period']>(budget?.period ?? 'quarter')
  const [from, setFrom] = useState(budget?.from ?? today())
  const [to, setTo] = useState(budget?.to ?? '')
  const [amount, setAmount] = useState(budget ? amountToInput(budget.amount) : '')
  const cents = parseAmount(amount)
  const valid = !!target && cents !== null && (period !== 'custom' || (!!from && !!to && to >= from))

  const save = async () => {
    if (!valid) return
    const [scope, targetId] = target.split(':') as [PeriodBudget['scope'], string]
    const values = { scope, targetId, amount: cents!, period, from: period === 'custom' ? from : undefined, to: period === 'custom' ? to : undefined }
    if (budget) await db.budgets.put({ ...budget, ...values })
    else await db.budgets.add({ ...values, id: newId(), createdAt: Date.now() })
    haptic()
    onClose()
  }

  return (
    <Sheet title={budget ? 'Zeitraum-Budget' : 'Neues Zeitraum-Budget'} onClose={onClose} full action={{ label: 'Sichern', disabled: !valid, onClick: save }}>
      <div className="group">
        <label className="row">
          <span className="row-main">Für</span>
          <select aria-label="Kategorie oder Überkategorie" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Bitte wählen</option>
            <optgroup label="Überkategorien">{groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}</optgroup>
            <optgroup label="Kategorien">{categories.map((c) => <option key={c.id} value={`category:${c.id}`}>{c.name}</option>)}</optgroup>
          </select>
        </label>
        <label className="row">
          <span className="row-main">Betrag in €</span>
          <input type="text" inputMode="decimal" placeholder="z. B. 300" aria-label="Betrag" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <h3 className="section-title">Zeitraum</h3>
      <Segmented value={period} options={[['quarter', 'Quartal'], ['year', 'Jahr'], ['custom', 'Von – Bis']]} onChange={setPeriod} />
      {period === 'custom'
        ? (
          <div className="group" style={{ marginTop: 10 }}>
            <label className="row"><span className="row-main">Von</span><input type="date" aria-label="Von" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="row"><span className="row-main">Bis</span><input type="date" aria-label="Bis" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )
        : <p className="section-foot">{period === 'quarter' ? 'Gilt jedes Quartal neu, z. B. „Shopping max. 300 € pro Quartal“.' : 'Gilt jedes Kalenderjahr neu, z. B. „Urlaub max. 2.000 € im Jahr“.'}</p>}
      {budget && <button className="row center danger" style={{ marginTop: 24, borderRadius: 12 }} onClick={async () => { await db.budgets.delete(budget.id); onClose() }}>Budget löschen</button>}
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

const GOAL_EMOJIS = ['🎯', '🏔️', '✈️', '🏖️', '🚗', '🏠', '💻', '📱', '🎓', '💍', '🎁', '🛟']

function GoalSheet({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const savings = useCategories().filter((c) => c.type === 'saving')
  const [name, setName] = useState(goal?.name ?? '')
  const [emoji, setEmoji] = useState(goal?.emoji ?? '🎯')
  const [target, setTarget] = useState(goal ? amountToInput(goal.target) : '')
  const [due, setDue] = useState(goal?.due ?? '')
  const [start, setStart] = useState(goal?.start ?? today())
  const [initial, setInitial] = useState(goal?.initial ? amountToInput(goal.initial) : '')
  const [chosen, setChosen] = useState<string[]>(goal?.categoryIds ?? [])
  const cents = parseAmount(target)
  const initialCents = initial.trim() ? parseAmount(initial) : 0
  const valid = !!name.trim() && cents !== null && !!due && due > start && initialCents !== null

  const save = async () => {
    if (!valid) return
    const values = { name: name.trim(), emoji, target: cents!, due, start, initial: initialCents || undefined, categoryIds: chosen.length ? chosen : undefined }
    if (goal) await db.goals.put({ ...goal, ...values })
    else await db.goals.add({ ...values, id: newId(), createdAt: Date.now() })
    haptic()
    onClose()
  }

  return (
    <Sheet title={goal ? 'Sparziel' : 'Neues Sparziel'} onClose={onClose} full action={{ label: 'Sichern', disabled: !valid, onClick: save }}>
      <div className="group">
        <label className="row">
          <span style={{ fontSize: 24 }} aria-hidden="true">{emoji}</span>
          <input className="left" type="text" placeholder="Name, z. B. Skiurlaub" aria-label="Name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="emoji-grid">{GOAL_EMOJIS.map((e) => <button key={e} aria-pressed={e === emoji} onClick={() => setEmoji(e)}>{e}</button>)}</div>
      </div>
      <div className="group" style={{ marginTop: 16 }}>
        <label className="row"><span className="row-main">Zielbetrag in €</span><input type="text" inputMode="decimal" placeholder="z. B. 1500" aria-label="Zielbetrag" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label className="row"><span className="row-main">Zieldatum</span><input type="date" aria-label="Zieldatum" value={due} min={start} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="row"><span className="row-main">Sparbuchungen ab</span><input type="date" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="row"><span className="row-main">Schon gespart in €</span><input type="text" inputMode="decimal" placeholder="0" aria-label="Schon gespart" value={initial} onChange={(e) => setInitial(e.target.value)} /></label>
      </div>
      <h3 className="section-title">Welche Sparbuchungen zählen?</h3>
      <div className="group">
        {savings.map((c) => (
          <button key={c.id} className="row" role="checkbox" aria-checked={chosen.length === 0 || chosen.includes(c.id)} onClick={() => {
            const all = chosen.length === 0 ? savings.map((x) => x.id) : chosen
            const next = all.includes(c.id) ? all.filter((x) => x !== c.id) : [...all, c.id]
            setChosen(next.length === savings.length ? [] : next)
          }}>
            <span className={chosen.length === 0 || chosen.includes(c.id) ? 'check on' : 'check'} aria-hidden="true">{(chosen.length === 0 || chosen.includes(c.id)) && <Check size={16} strokeWidth={3} />}</span>
            <CategoryIcon category={c} size={28} />
            <span className="row-main">{c.name}</span>
          </button>
        ))}
      </div>
      <p className="section-foot">Zählen alle Buchungen der Art „Sparen“ ab dem Startdatum. Nimm Kategorien heraus, die nicht für dieses Ziel sind.</p>
      {goal && (
        <div className="group" style={{ marginTop: 24 }}>
          <button className="row tint" onClick={async () => { await db.goals.update(goal.id, { archived: !goal.archived }); onClose() }}>{goal.archived ? 'Aus dem Archiv holen' : 'Archivieren'}</button>
          <button className="row danger" onClick={async () => { await db.goals.delete(goal.id); onClose() }}>Sparziel löschen</button>
        </div>
      )}
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

export interface ShownItem extends Item {
  icon: ReactNode
  sub?: string
  goalRecord?: Goal
  open: () => void
}

/** Every budget and goal with its progress, for the page and the overview */
export function useBudgetItems(month: string, onOpen: (item: { kind: Item['kind']; id: string }) => void): ShownItem[] {
  const { openLabel } = useApp()
  const categories = useCategories()
  const groups = useGroups()
  const labels = useLabels()
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [] as PeriodBudget[])
  const goals = useLiveQuery(() => db.goals.filter((g) => !g.archived).toArray(), [], [] as Goal[])
  const entries = useLiveQuery(() => db.entries.toArray(), [], [] as Entry[])
  const now = today()
  return useMemo(() => {
    const items: ShownItem[] = []
    for (const goal of goals) {
      items.push({ key: `goal:${goal.id}`, kind: 'goal', name: goal.name, goal: goalProgress(entries, goal, now), goalRecord: goal, icon: <span className="goal-emoji" aria-hidden="true">{goal.emoji}</span>, open: () => onOpen({ kind: 'goal', id: goal.id }) })
    }
    for (const g of groups.filter((x) => x.type === 'expense' && x.budget)) {
      items.push({ key: `group:${g.id}`, kind: 'group', name: g.name, sub: 'Überkategorie', progress: monthProgress(entries, groupCategoryIds(g, categories), g.budget!, month, now, formatEuro), icon: <span className="dot" style={{ background: g.color }} />, open: () => onOpen({ kind: 'group', id: g.id }) })
    }
    for (const c of categories.filter((x) => x.type === 'expense' && x.budget)) {
      items.push({ key: `category:${c.id}`, kind: 'category', name: c.name, progress: monthProgress(entries, new Set([c.id]), c.budget!, month, now, formatEuro), icon: <CategoryIcon category={c} size={26} />, open: () => onOpen({ kind: 'category', id: c.id }) })
    }
    for (const b of budgets) {
      const target = b.scope === 'group' ? groups.find((g) => g.id === b.targetId) : categories.find((c) => c.id === b.targetId)
      if (!target) continue
      items.push({
        key: `period:${b.id}`, kind: 'period', name: target.name, sub: periodName(b, now), progress: periodProgress(entries, b, categories, groups, now, formatEuro),
        icon: b.scope === 'group' ? <span className="dot" style={{ background: target.color }} /> : <CategoryIcon category={target as Category} size={26} />,
        open: () => onOpen({ kind: 'period', id: b.id }),
      })
    }
    for (const l of labels.filter((x) => x.budget && !x.archived)) {
      items.push({ key: `label:${l.id}`, kind: 'label', name: l.name, sub: 'Label', progress: labelProgress(entries, l, now, formatEuro), icon: <span className="label-dot" style={{ '--c': l.color } as React.CSSProperties}><LabelGlyph label={l} size={14} /></span>, open: () => openLabel(l.id) })
    }
    return items
  }, [goals, groups, categories, budgets, labels, entries, month, now, onOpen, openLabel])
}

export function Budgets() {
  const { month, setMonth } = useApp()
  const categories = useCategories()
  const groups = useGroups()
  const entries = useMonthEntries(month)
  const [editing, setEditing] = useState<{ kind: Item['kind'] | 'new-goal' | 'new-period'; id?: string } | null>(null)
  const swipe = useMonthSwipe(month, setMonth)
  const items = useBudgetItems(month, setEditing)
  const archived = useLiveQuery(() => db.goals.filter((g) => !!g.archived).toArray(), [], [] as Goal[])

  const rows = budgetRows(entries, categories)
  const free = categories.filter((c) => c.type === 'expense' && !c.budget)
  const freeGroups = groups.filter((g) => g.type === 'expense' && !g.budget)
  const monthly = items.filter((i) => i.kind === 'category' || i.kind === 'group')
  const budget = monthly.filter((i) => i.kind === 'category').reduce((sum, i) => sum + i.progress!.budget, 0)
  const spent = rows.reduce((sum, r) => sum + r.spent, 0)
  const of = (kind: Item['kind']) => items.filter((i) => i.kind === kind)
  const editedGoal = editing?.kind === 'goal' ? [...items.map((i) => i.goalRecord), ...archived].find((g) => g?.id === editing.id) : undefined
  const editedCategory = editing?.kind === 'category' ? categories.find((c) => c.id === editing.id) : undefined
  const editedGroup = editing?.kind === 'group' ? groups.find((g) => g.id === editing.id) : undefined

  return (
    <main className="page" {...swipe}>
      <h1 className="page-title">Budgets & Ziele</h1>

      <div className="section-head">
        <h2 className="section-title strong">Sparziele</h2>
        <button className="link-btn" onClick={() => setEditing({ kind: 'new-goal' })}>+ Sparziel</button>
      </div>
      {of('goal').length === 0
        ? (
          <button className="card empty-card" onClick={() => setEditing({ kind: 'new-goal' })}>
            <Target size={22} strokeWidth={1.8} aria-hidden="true" />
            <span><b>Sparziel anlegen</b><span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>Name, Zielbetrag und Zieldatum. Die App zeigt, was noch fehlt und welche Monatsrate nötig ist.</span></span>
          </button>
        )
        : <div className="stack">{of('goal').map((i) => <GoalCard key={i.key} goal={i.goalRecord!} p={i.goal!} onClick={i.open} />)}</div>}

      <h2 className="section-title strong">Monatsbudgets</h2>
      <MonthPicker month={month} onChange={setMonth} />
      {rows.length > 0 && (
        <div className="card">
          <div className="rate">
            <div>
              <div className="row-sub">Budgetiert ausgegeben</div>
              <strong className="num">{formatEuro(spent)}</strong>
            </div>
            <span className="row-sub num">{formatPercent(spent / budget)} von {formatEuro(budget)}</span>
          </div>
        </div>
      )}
      {of('group').length > 0 && (
        <>
          <h3 className="section-title">Überkategorien</h3>
          <div className="group">{of('group').map((i) => <ProgressRow key={i.key} icon={i.icon} name={i.name} p={i.progress!} onClick={i.open} />)}</div>
        </>
      )}
      {of('category').length > 0 && (
        <>
          <h3 className="section-title">Kategorien</h3>
          <div className="group">{of('category').map((i) => <ProgressRow key={i.key} icon={i.icon} name={i.name} p={i.progress!} onClick={i.open} />)}</div>
        </>
      )}

      <div className="section-head">
        <h2 className="section-title strong">Zeitraum-Budgets</h2>
        <button className="link-btn" onClick={() => setEditing({ kind: 'new-period' })}>+ Budget</button>
      </div>
      {of('period').length === 0
        ? <p className="section-foot">Für ein Quartal, ein Jahr oder feste Daten, z. B. „Shopping max. 300 € pro Quartal“.</p>
        : <div className="group">{of('period').map((i) => <ProgressRow key={i.key} icon={i.icon} name={i.name} sub={i.sub} p={i.progress!} onClick={i.open} />)}</div>}

      {of('label').length > 0 && (
        <>
          <h2 className="section-title strong">Label-Budgets</h2>
          <div className="group">{of('label').map((i) => <ProgressRow key={i.key} icon={i.icon} name={i.name} sub={i.sub} p={i.progress!} onClick={i.open} />)}</div>
          <p className="section-foot">Das Budget eines Labels legst du im Label fest (Einstellungen › Labels).</p>
        </>
      )}

      {(freeGroups.length > 0 || free.length > 0) && (
        <>
          <h2 className="section-title strong">Ohne Monatsbudget</h2>
          <div className="group">
            {freeGroups.map((g) => (
              <button key={g.id} className="row" onClick={() => setEditing({ kind: 'group', id: g.id })}>
                <span className="dot" style={{ background: g.color }} />
                <span className="row-main row-title">{g.name} <span className="row-sub">· Überkategorie</span></span>
                <span className="row-value" style={{ fontSize: 15 }}>Festlegen</span>
                <span className="chevron"><Icon name="right" size={16} /></span>
              </button>
            ))}
            {free.map((c) => (
              <button key={c.id} className="row" onClick={() => setEditing({ kind: 'category', id: c.id })}>
                <CategoryIcon category={c} />
                <span className="row-main row-title">{c.name}</span>
                <span className="row-value" style={{ fontSize: 15 }}>Festlegen</span>
                <span className="chevron"><Icon name="right" size={16} /></span>
              </button>
            ))}
          </div>
        </>
      )}

      {archived.length > 0 && (
        <>
          <h2 className="section-title">Archivierte Sparziele</h2>
          <div className="group">
            {archived.map((g) => (
              <button key={g.id} className="row" onClick={() => setEditing({ kind: 'goal', id: g.id })}>
                <span aria-hidden="true">{g.emoji}</span><span className="row-main">{g.name}</span><span className="row-value num">{formatEuro(g.target)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {editedCategory && <AmountSheet title={editedCategory.name} current={editedCategory.budget} onSave={(cents) => db.categories.update(editedCategory.id, { budget: cents })} onClose={() => setEditing(null)} />}
      {editedGroup && <AmountSheet title={editedGroup.name} current={editedGroup.budget} onSave={(cents) => db.groups.update(editedGroup.id, { budget: cents } as Partial<Group>)} onClose={() => setEditing(null)} />}
      {(editing?.kind === 'new-goal' || editedGoal) && <GoalSheet goal={editedGoal} onClose={() => setEditing(null)} />}
      {editing?.kind === 'new-period' && <PeriodSheet onClose={() => setEditing(null)} />}
      {editing?.kind === 'period' && <PeriodEdit id={editing.id!} onClose={() => setEditing(null)} />}
    </main>
  )
}

function PeriodEdit({ id, onClose }: { id: string; onClose: () => void }) {
  const budget = useLiveQuery(() => db.budgets.get(id), [id])
  return budget ? <PeriodSheet budget={budget} onClose={onClose} /> : null
}
