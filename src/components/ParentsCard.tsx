import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check } from 'lucide-react'
import { db, PARENTS_EXPENSE, setMeta, type Entry } from '../db'
import { useApp } from '../context'
import { formatDate } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { haptic } from '../lib/haptics'
import { openItems, refundDifference, suggestRefund } from '../lib/parents'
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

function RefundRow({ entry }: { entry: Entry }) {
  const toggle = () => {
    haptic()
    db.entries.update(entry.id, { refunded: !entry.refunded })
  }
  return (
    <button className="row" role="checkbox" aria-checked={!!entry.refunded} onClick={toggle}>
      <span className={entry.refunded ? 'check on' : 'check'} aria-hidden="true">{entry.refunded && <Check size={16} strokeWidth={3} />}</span>
      <span className="row-main">
        <span className="row-title" style={{ display: 'block' }}>{entry.note || entry.merchant || 'Eltern'}</span>
        <span className="row-sub" style={{ display: 'block' }}>{formatDate(entry.date)}{entry.refunded ? ' · erstattet' : ''}</span>
      </span>
      <span className="row-value num">{formatEuro(entry.amount)}</span>
    </button>
  )
}

/** After a repayment: which open expenses it covers. Suggests a fitting selection, the user can change it. */
export function RefundSheet({ refund, onClose }: { refund: Entry; onClose: () => void }) {
  const { toast } = useApp()
  const open = useLiveQuery(() => db.entries.where('categoryId').equals(PARENTS_EXPENSE).toArray().then(openItems), [])
  const [selected, setSelected] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!open) return
    if (open.length === 0) onClose()
    else if (selected === null) setSelected(new Set(suggestRefund(open, refund.amount)))
  }, [open, selected, refund.amount, onClose])

  if (!open || open.length === 0 || selected === null) return null
  const total = open.filter((e) => selected.has(e.id)).reduce((sum, e) => sum + e.amount, 0)
  const exact = total === refund.amount

  const toggle = (id: string) => {
    haptic()
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const confirm = async () => {
    await db.entries.bulkUpdate([...selected].map((key) => ({ key, changes: { refunded: true } })))
    haptic()
    toast(selected.size === 1 ? '1 Posten als erstattet markiert' : `${selected.size} Posten als erstattet markiert`)
    onClose()
  }

  return (
    <Sheet title="Eltern-Posten" onClose={onClose} full action={{ label: 'Markieren', onClick: confirm, disabled: selected.size === 0 }}>
      <h3 className="sheet-question">Offene Eltern-Posten als erstattet markieren?</h3>
      <div className="card stat-card">
        <span className="row-sub">Rückzahlung</span>
        <strong className="mid-num num">{formatEuro(refund.amount)}</strong>
        <div className="mini-stats num">
          <span>Ausgewählt {formatEuro(total)}</span>
          <span className={exact ? 'refund-diff ok' : 'refund-diff'}>{refundDifference(refund.amount, total, formatEuro)}</span>
        </div>
      </div>
      <p className="section-foot">Vorgeschlagen sind die ältesten Posten, die zusammen zur Rückzahlung passen. Tippe einen Posten an, um ihn dazuzunehmen oder herauszunehmen.</p>
      <h3 className="section-title">Noch nicht erstattet, älteste zuerst</h3>
      <div className="group">
        {open.map((e) => (
          <button key={e.id} className="row" role="checkbox" aria-checked={selected.has(e.id)} onClick={() => toggle(e.id)}>
            <span className={selected.has(e.id) ? 'check on' : 'check'} aria-hidden="true">{selected.has(e.id) && <Check size={16} strokeWidth={3} />}</span>
            <span className="row-main">
              <span className="row-title" style={{ display: 'block' }}>{e.note || e.merchant || 'Eltern'}</span>
              <span className="row-sub" style={{ display: 'block' }}>{formatDate(e.date)}</span>
            </span>
            <span className="row-value num">{formatEuro(e.amount)}</span>
          </button>
        ))}
      </div>
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

/** Everything the parents still owe, with the single expenses to tick off. */
export function ParentsSheet({ entries, onClose }: { entries: Entry[]; onClose: () => void }) {
  const balance = parentsBalance(entries)
  const open = balance.entries.filter((e) => !e.refunded)
  const done = balance.entries.filter((e) => e.refunded)
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
      <p className="section-foot">Offen = alle Ausgaben in „Eltern“ minus alle Einnahmen in „Kostenrückzahlung Eltern“. Abhaken zeigt dir, welche Ausgaben schon zurückgezahlt sind.</p>
      {open.length > 0 && (
        <>
          <h3 className="section-title">Noch nicht erstattet</h3>
          <div className="group">{open.map((e) => <RefundRow key={e.id} entry={e} />)}</div>
        </>
      )}
      {done.length > 0 && (
        <>
          <h3 className="section-title">Erstattet</h3>
          <div className="group">{done.map((e) => <RefundRow key={e.id} entry={e} />)}</div>
        </>
      )}
      {balance.entries.length === 0 && <div className="empty"><b>Noch keine Eltern-Ausgaben</b>Buche Ausgaben für deine Eltern in der Kategorie „Eltern“.</div>}
    </Sheet>
  )
}

export function ParentsCard({ entries }: { entries: Entry[] }) {
  const [open, setOpen] = useState(false)
  const balance = parentsBalance(entries)
  const pending = balance.entries.filter((e) => !e.refunded).length
  if (balance.entries.length === 0 && balance.refunded === 0) return null
  return (
    <>
      <button className="card stat-card tappable" onClick={() => setOpen(true)}>
        <span className="row-sub">Offen von Eltern</span>
        <strong className="mid-num num">{formatEuro(balance.open)}</strong>
        <span className="row-sub">{pending === 0 ? 'Alle Ausgaben abgehakt' : `${pending} ${pending === 1 ? 'Ausgabe' : 'Ausgaben'} noch nicht abgehakt`} ›</span>
      </button>
      {open && <ParentsSheet entries={entries} onClose={() => setOpen(false)} />}
    </>
  )
}
