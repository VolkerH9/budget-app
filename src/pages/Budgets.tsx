import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category, type Entry } from '../db'
import { useApp, useCategories } from '../context'
import { Icon } from '../components/Icon'
import { AmountDisplay, Keypad } from '../components/Keypad'
import { CategoryIcon, MonthPicker, Sheet, useMonthSwipe } from '../components/ui'
import { monthRange } from '../lib/dates'
import { amountToInput, formatEuro, formatPercent, parseAmount } from '../lib/format'
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

export function BudgetBar({ row, onClick }: { row: BudgetRow; onClick?: () => void }) {
  const content = (
    <>
      <div className="budget-head">
        <span className="budget-name">
          <span aria-hidden="true">{row.category.emoji}</span>
          <span>{row.category.name}</span>
        </span>
        <span className={`status ${row.level}`} style={{ marginTop: 0 }}>{STATUS[row.level]}</span>
      </div>
      <div className={`bar ${row.level}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(row.ratio * 100))} aria-label={row.category.name}>
        <div style={{ width: `${Math.min(100, row.ratio * 100)}%` }} />
      </div>
      <div className="budget-foot num">
        <span>{formatEuro(row.spent)} von {formatEuro(row.budget)}</span>
        <span className={row.rest < 0 ? 'danger' : undefined}>{row.rest < 0 ? `${formatEuro(-row.rest)} drüber` : `${formatEuro(row.rest)} übrig`}</span>
      </div>
    </>
  )
  return onClick
    ? <button className="budget" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={onClick}>{content}</button>
    : <div className="budget">{content}</div>
}

function BudgetSheet({ category, onClose }: { category: Category; onClose: () => void }) {
  const [text, setText] = useState(category.budget ? amountToInput(category.budget) : '')
  const cents = parseAmount(text)
  return (
    <Sheet
      title={`${category.emoji} ${category.name}`}
      onClose={onClose}
      action={{ label: 'Sichern', disabled: cents === null, onClick: async () => { await db.categories.update(category.id, { budget: cents! }); onClose() } }}
    >
      <p className="section-foot" style={{ textAlign: 'center' }}>Monatliches Budget</p>
      <AmountDisplay text={text} />
      <Keypad onChange={setText} />
      {category.budget && (
        <button className="row center danger" style={{ marginTop: 12, borderRadius: 12 }} onClick={async () => { await db.categories.update(category.id, { budget: undefined }); onClose() }}>
          Budget entfernen
        </button>
      )}
    </Sheet>
  )
}

export function Budgets() {
  const { month, setMonth } = useApp()
  const categories = useCategories()
  const entries = useMonthEntries(month)
  const [editing, setEditing] = useState<Category | null>(null)
  const swipe = useMonthSwipe(month, setMonth)

  const rows = budgetRows(entries, categories)
  const free = categories.filter((c) => c.type === 'expense' && !c.budget)
  const budget = rows.reduce((sum, r) => sum + r.budget, 0)
  const spent = rows.reduce((sum, r) => sum + r.spent, 0)

  return (
    <main className="page" {...swipe}>
      <h1 className="page-title">Budgets</h1>
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

      {rows.length > 0 && (
        <>
          <h2 className="section-title">Mit Budget</h2>
          <div className="group">
            {rows.map((row) => <BudgetBar key={row.category.id} row={row} onClick={() => setEditing(row.category)} />)}
          </div>
        </>
      )}

      {free.length > 0 && (
        <>
          <h2 className="section-title">Ohne Budget</h2>
          <div className="group">
            {free.map((c) => (
              <button key={c.id} className="row" onClick={() => setEditing(c)}>
                <CategoryIcon emoji={c.emoji} color={c.color} />
                <span className="row-main row-title">{c.name}</span>
                <span className="row-value" style={{ fontSize: 15 }}>Festlegen</span>
                <span className="chevron"><Icon name="right" size={16} /></span>
              </button>
            ))}
          </div>
        </>
      )}
      {editing && <BudgetSheet category={editing} onClose={() => setEditing(null)} />}
    </main>
  )
}
