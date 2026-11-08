import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check } from 'lucide-react'
import { db, PARENT_CATEGORIES, setMeta, type Entry } from '../db'
import { useApp } from '../context'
import { formatDate, monthLabel, today } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { haptic } from '../lib/haptics'
import { paymentEffect, settledItems, statements, STATUS_LABEL, type Statement, type StatementBook } from '../lib/parents'
import { parentsBalance } from '../lib/stats'
import { Sheet, Switch } from './ui'

export function HideParentsRow({ hide }: { hide: boolean }) {
  return (
    <div className="row">
      <span className="row-main">
        Eltern-Kosten ausblenden
        <span className="row-sub" style={{ display: 'block' }}>Nimmt „Eltern“ und „Kostenrückzahlung Eltern“ aus allen Summen</span>
      </span>
      <Switch label="Eltern-Kosten ausblenden" checked={hide} onChange={(value) => setMeta('hideParents', value)} />
    </div>
  )
}

/** All parents entries and the monthly statements made from them */
export function useStatements(): { entries: Entry[]; book: StatementBook } {
  const entries = useLiveQuery(() => db.entries.where('categoryId').anyOf(PARENT_CATEGORIES).toArray(), [], [] as Entry[])
  const book = useMemo(() => statements(entries, today()), [entries])
  return { entries, book }
}

export function StatusBadge({ statement }: { statement: Statement }) {
  return <span className={`badge status-${statement.status}`}>{statement.running && statement.status !== 'paid' ? 'läuft noch' : STATUS_LABEL[statement.status]}</span>
}

function RefundRow({ entry, byStatement }: { entry: Entry; byStatement: boolean }) {
  const settled = !!entry.refunded || byStatement
  const toggle = () => {
    haptic()
    db.entries.update(entry.id, { refunded: !entry.refunded })
  }
  return (
    <button className="row" role="checkbox" aria-checked={settled} disabled={byStatement} onClick={toggle}>
      <span className={settled ? 'check on' : 'check'} aria-hidden="true">{settled && <Check size={16} strokeWidth={3} />}</span>
      <span className="row-main">
        <span className="row-title" style={{ display: 'block' }}>{entry.note || entry.merchant || 'Eltern'}</span>
        <span className="row-sub" style={{ display: 'block' }}>{formatDate(entry.date)}{byStatement ? ' · Abrechnung bezahlt' : entry.refunded ? ' · erstattet' : ''}</span>
      </span>
      <span className="row-value num">{formatEuro(entry.amount)}</span>
    </button>
  )
}

/** After a repayment: which monthly statement it pays. The oldest open one is suggested. */
export function AssignSheet({ refund, onClose }: { refund: Entry; onClose: () => void }) {
  const { toast } = useApp()
  const { entries } = useStatements()
  // The statements as they were before this repayment
  const before = useMemo(() => statements(entries.filter((e) => e.id !== refund.id), today()), [entries, refund.id])
  const open = before.statements.filter((s) => s.open > 0)
  const [month, setMonth] = useState<string | null>(null)
  const loaded = entries.some((e) => e.id === refund.id)

  useEffect(() => {
    if (!loaded) return
    if (open.length === 0) onClose()
    else if (month === null) setMonth(open[0].month)
  }, [loaded, open, month, onClose])

  if (!loaded || open.length === 0 || month === null) return null

  const confirm = async () => {
    await db.entries.update(refund.id, { forMonth: month })
    haptic()
    toast(`Zahlung der Abrechnung ${monthLabel(month)} zugeordnet`)
    onClose()
  }

  return (
    <Sheet title="Rückzahlung" onClose={onClose} full action={{ label: 'Zuordnen', onClick: confirm }}>
      <h3 className="sheet-question">Für welche Abrechnung ist die Zahlung?</h3>
      <div className="card stat-card">
        <span className="row-sub">Rückzahlung</span>
        <strong className="mid-num num">{formatEuro(refund.amount)}</strong>
      </div>
      <p className="section-foot">Vorgeschlagen ist die älteste offene Abrechnung. Ist die Zahlung kleiner als der offene Betrag, ist die Abrechnung danach teilweise bezahlt.</p>
      <h3 className="section-title">Offene Abrechnungen, älteste zuerst</h3>
      <div className="group">
        {open.map((s) => (
          <button key={s.month} className="row" role="radio" aria-checked={s.month === month} onClick={() => { haptic(); setMonth(s.month) }}>
            <span className={s.month === month ? 'check on' : 'check'} aria-hidden="true">{s.month === month && <Check size={16} strokeWidth={3} />}</span>
            <span className="row-main">
              <span className="row-title" style={{ display: 'block' }}>{monthLabel(s.month)}</span>
              <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>
                <StatusBadge statement={s} />
                {s.month === month ? paymentEffect(s.open, refund.amount, formatEuro) : `${formatEuro(s.total)} gesamt`}
              </span>
            </span>
            <span className="row-value num">{formatEuro(s.open)} offen</span>
          </button>
        ))}
      </div>
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

function StatementRow({ statement }: { statement: Statement }) {
  const { openReport } = useApp()
  return (
    <button className="row" onClick={() => openReport({ month: statement.month, kind: 'parents' })}>
      <span className="row-main">
        <span className="row-title" style={{ display: 'block' }}>{monthLabel(statement.month)}</span>
        <span className="row-sub" style={{ display: 'block' }}>
          <StatusBadge statement={statement} />
          {statement.items.length} Posten · {formatEuro(statement.total)}
        </span>
      </span>
      <span className="row-value num">{statement.open > 0 ? `${formatEuro(statement.open)} offen` : '✓'}</span>
      <span className="chevron" aria-hidden="true">›</span>
    </button>
  )
}

/** Everything the parents still owe: the monthly statements and the single expenses. */
export function ParentsSheet({ onClose }: { onClose: () => void }) {
  const { entries, book } = useStatements()
  const balance = parentsBalance(entries)
  const settled = settledItems(book)
  const byStatement = new Set(book.statements.filter((s) => s.status === 'paid').flatMap((s) => s.items.map((e) => e.id)))
  const open = balance.entries.filter((e) => !settled.has(e.id))
  const done = balance.entries.filter((e) => settled.has(e.id))
  return (
    <Sheet title="Eltern-Kosten" onClose={onClose} full>
      <div className="card stat-card">
        <span className="row-sub">Offen von Eltern</span>
        <strong className="hero-num num">{formatEuro(balance.open)}</strong>
        <div className="mini-stats num">
          <span>Ausgaben {formatEuro(balance.spent)}</span>
          <span>Rückzahlungen {formatEuro(balance.refunded)}</span>
        </div>
      </div>
      <p className="section-foot">Offen = alle Ausgaben in „Eltern“ minus alle Einnahmen in „Kostenrückzahlung Eltern“. Jeder Monat mit Eltern-Ausgaben hat eine eigene Abrechnung. Rückzahlungen bezahlen die Abrechnung, der du sie zuordnest, sonst die älteste offene.</p>
      {book.statements.length > 0 && (
        <>
          <h3 className="section-title">Abrechnungen</h3>
          <div className="group">{[...book.statements].reverse().map((s) => <StatementRow key={s.month} statement={s} />)}</div>
          {book.credit > 0 && <p className="section-foot">Deine Eltern haben {formatEuro(book.credit)} mehr gezahlt, als offen war. Das verrechnet die App mit der nächsten Abrechnung.</p>}
        </>
      )}
      {open.length > 0 && (
        <>
          <h3 className="section-title">Noch nicht erstattet</h3>
          <div className="group">{open.map((e) => <RefundRow key={e.id} entry={e} byStatement={false} />)}</div>
        </>
      )}
      {done.length > 0 && (
        <>
          <h3 className="section-title">Erstattet</h3>
          <div className="group">{done.map((e) => <RefundRow key={e.id} entry={e} byStatement={byStatement.has(e.id)} />)}</div>
        </>
      )}
      {balance.entries.length === 0 && <div className="empty"><b>Noch keine Eltern-Ausgaben</b>Buche Ausgaben für deine Eltern in der Kategorie „Eltern“.</div>}
    </Sheet>
  )
}

export function ParentsCard({ entries }: { entries: Entry[] }) {
  const [open, setOpen] = useState(false)
  const balance = parentsBalance(entries)
  const book = useMemo(() => statements(entries, today()), [entries])
  if (balance.entries.length === 0 && balance.refunded === 0) return null
  const unpaid = book.statements.filter((s) => s.open > 0 && !s.running)
  const partial = unpaid.filter((s) => s.status === 'partial').length
  const text = unpaid.length === 0
    ? 'Alle Abrechnungen bezahlt'
    : `${unpaid.length} ${unpaid.length === 1 ? 'Abrechnung' : 'Abrechnungen'} offen${partial > 0 ? `, ${partial} teilweise bezahlt` : ''}`
  return (
    <>
      <button className="card stat-card tappable" onClick={() => setOpen(true)}>
        <span className="row-sub">Offen von Eltern</span>
        <strong className="mid-num num">{formatEuro(balance.open)}</strong>
        <span className="row-sub">{text} ›</span>
      </button>
      {open && <ParentsSheet onClose={() => setOpen(false)} />}
    </>
  )
}
