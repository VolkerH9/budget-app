import { useState } from 'react'
import { Check } from 'lucide-react'
import { db, setMeta, type Entry } from '../db'
import { formatDate } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { haptic } from '../lib/haptics'
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
