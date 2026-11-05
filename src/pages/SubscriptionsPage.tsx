import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarPlus } from 'lucide-react'
import { db, newId, setMeta, SUBSCRIPTION_CATEGORY, type Recurring } from '../db'
import { useApp, useCategories, useMeta } from '../context'
import { CategoryIcon } from '../components/CategoryIcon'
import { Icon } from '../components/Icon'
import { Segmented, Sheet, Switch } from '../components/ui'
import { saveFile } from '../lib/backup'
import { bookDueEntries, countBacklog, resumeNextDue } from '../lib/booking'
import { formatDate, today } from '../lib/dates'
import { amountToInput, formatEuro, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { firstOnOrAfter } from '../lib/recurring'
import { intervalLabel, isDraft, noticeDeadline, subscriptionIcs, totals } from '../lib/subscriptions'
import { SubPage } from './Settings'

type Kind = 'monthly' | 'yearly' | 'custom'
const KINDS: [Kind, string][] = [['monthly', 'Monatlich'], ['yearly', 'Jährlich'], ['custom', 'Individuell']]
const NOTICE: [number, string][] = [[0, 'Keine'], [7, '1 Woche'], [14, '2 Wochen'], [30, '1 Monat'], [60, '2 Monate'], [90, '3 Monate']]
const LEAD: [number, string][] = [[1, '1 Tag'], [3, '3 Tage'], [7, '7 Tage'], [14, '14 Tage'], [30, '30 Tage']]

async function addToCalendar(item: Recurring, lead: number) {
  await saveFile(`Abo-${item.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.ics`, subscriptionIcs(item, lead), 'text/calendar')
}

function SubscriptionSheet({ item, onClose }: { item?: Recurring; onClose: () => void }) {
  const { alert, toast } = useApp()
  const categories = useCategories()
  const lead = useMeta('reminderDays', 7)
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item && item.amount > 0 ? amountToInput(item.amount) : '')
  const [kind, setKind] = useState<Kind>(item?.interval === 'yearly' ? 'yearly' : item?.interval === 'custom' ? 'custom' : 'monthly')
  const [months, setMonths] = useState(item?.everyMonths ?? 3)
  const [next, setNext] = useState(item && !isDraft(item) ? item.nextDue : '')
  const [notice, setNotice] = useState(item?.subscription?.noticeDays ?? 0)
  const [note, setNote] = useState(item?.subscription?.note ?? '')
  const [paused, setPaused] = useState(item ? item.paused && !isDraft(item) : false)

  const cents = parseAmount(amount)
  const valid = !!name.trim() && cents !== null && !!next
  const categoryId = categories.find((c) => c.id === SUBSCRIPTION_CATEGORY)?.id ?? categories.find((c) => c.type === 'expense')?.id ?? ''

  const build = (catchUp: boolean): Recurring => {
    const schedule = { interval: kind, everyMonths: kind === 'custom' ? months : undefined, bookingDay: Number(next.slice(8, 10)), startDate: next }
    const changed = !item || isDraft(item) || item.nextDue !== next || item.interval !== kind || item.everyMonths !== schedule.everyMonths
    let nextDue = item?.nextDue ?? next
    if (changed) nextDue = catchUp ? next : firstOnOrAfter(schedule, today())
    else if (item?.paused && !paused) nextDue = resumeNextDue({ ...item, ...schedule })
    return {
      ...schedule,
      id: item?.id ?? newId(),
      name: name.trim(),
      amount: cents!,
      type: 'expense',
      categoryId: item?.categoryId ?? categoryId,
      paused,
      nextDue,
      subscription: { noticeDays: notice || undefined, note: note.trim() || undefined },
    }
  }

  const save = async (catchUp: boolean) => {
    await db.recurring.put(build(catchUp))
    const booked = await bookDueEntries()
    haptic()
    toast(booked > 0 ? `Abo gespeichert, ${booked} ${booked === 1 ? 'Abbuchung' : 'Abbuchungen'} gebucht` : 'Abo gespeichert')
    onClose()
  }

  const onSave = () => {
    const schedule = { interval: kind, everyMonths: months, bookingDay: Number(next.slice(8, 10)), startDate: next }
    const backlog = next < today() && (!item || isDraft(item) || item.nextDue !== next) ? countBacklog(schedule) : 0
    if (backlog === 0) {
      save(true)
      return
    }
    alert({
      title: 'Rückwirkend buchen?',
      message: `Das Datum liegt in der Vergangenheit. Seitdem wären ${backlog === 1 ? '1 Abbuchung' : `${backlog} Abbuchungen`} fällig gewesen.`,
      buttons: [
        { label: backlog === 1 ? 'Nachbuchen' : `Alle ${backlog} nachbuchen`, style: 'strong', onClick: () => save(true) },
        { label: 'Erst ab heute buchen', onClick: () => save(false) },
        { label: 'Abbrechen' },
      ],
    })
  }

  const remove = () => alert({
    title: `„${item!.name}“ löschen?`,
    message: 'Bereits gebuchte Abbuchungen bleiben als Einträge erhalten.',
    buttons: [
      { label: 'Löschen', style: 'destructive', onClick: async () => { await db.recurring.delete(item!.id); toast('Abo gelöscht'); onClose() } },
      { label: 'Abbrechen', style: 'strong' },
    ],
  })

  return (
    <Sheet title={item ? 'Abo bearbeiten' : 'Neues Abo'} onClose={onClose} full action={{ label: 'Sichern', disabled: !valid, onClick: onSave }}>
      <div className="group">
        <div className="row"><input className="left" type="text" placeholder="Name, z. B. Spotify" aria-label="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <label className="row">
          <span className="row-main">Betrag</span>
          <input type="text" inputMode="decimal" placeholder="0,00" aria-label="Betrag in Euro" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="row-value">€</span>
        </label>
      </div>
      <h3 className="section-title">Intervall</h3>
      <Segmented value={kind} options={KINDS} onChange={setKind} />
      <div className="group" style={{ marginTop: 10 }}>
        {kind === 'custom' && (
          <label className="row">
            <span className="row-main">Alle</span>
            <select aria-label="Anzahl Monate" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {Array.from({ length: 23 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} Monate</option>)}
            </select>
          </label>
        )}
        <label className="row">
          <span className="row-main">Nächste Abbuchung</span>
          <input type="date" aria-label="Nächste Abbuchung" value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
        <label className="row">
          <span className="row-main">Kündigungsfrist</span>
          <select aria-label="Kündigungsfrist" value={notice} onChange={(e) => setNotice(Number(e.target.value))}>
            {NOTICE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="row"><input className="left" type="text" placeholder="Notiz (optional)" aria-label="Notiz" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <p className="section-foot">
        Das Abo wird an jedem Abbuchungstag automatisch als Ausgabe in „Abos“ gebucht.
        {notice > 0 && next && ` Kündigen bis spätestens ${formatDate(firstDeadline(next, notice))}.`}
      </p>
      {item && !isDraft(item) && (
        <div className="group" style={{ marginTop: 20 }}>
          <div className="row">
            <span className="row-main">Pausiert</span>
            <Switch label="Pausiert" checked={paused} onChange={setPaused} />
          </div>
        </div>
      )}
      {item && !isDraft(item) && (
        <button className="row tint" style={{ marginTop: 20, borderRadius: 12 }} onClick={() => addToCalendar(item, lead)}>
          <CalendarPlus size={20} strokeWidth={1.8} /> Erinnerung in den Kalender
        </button>
      )}
      {item && <button className="row center danger" style={{ marginTop: 20, borderRadius: 12 }} onClick={remove}>Abo löschen</button>}
    </Sheet>
  )
}

function firstDeadline(next: string, notice: number) {
  return noticeDeadline({ nextDue: next, subscription: { noticeDays: notice } } as Recurring)!
}

export function SubscriptionsPage({ onBack }: { onBack: () => void }) {
  const categories = useCategories()
  const lead = useMeta('reminderDays', 7)
  const items = useLiveQuery(() => db.recurring.filter((r) => !!r.subscription).toArray(), [], [] as Recurring[])
  const [editing, setEditing] = useState<{ item?: Recurring } | null>(null)
  const sum = totals(items)
  const sorted = [...items].sort((a, b) => Number(isDraft(a) || a.paused) - Number(isDraft(b) || b.paused) || a.nextDue.localeCompare(b.nextDue))
  const category = categories.find((c) => c.id === SUBSCRIPTION_CATEGORY)

  return (
    <SubPage title="Abos" onBack={onBack}>
      <div className="card hero">
        <span className="row-sub">Aktive Abos pro Monat</span>
        <strong className="hero-num num">{formatEuro(sum.month)}</strong>
        <span className="row-sub num" style={{ display: 'block', whiteSpace: 'normal' }}>{formatEuro(sum.year)} pro Jahr · jährliche Abos auf den Monat umgerechnet</span>
      </div>

      <div className="group" style={{ marginTop: 16 }}>
        {sorted.map((r) => {
          const deadline = noticeDeadline(r)
          let status = `${intervalLabel(r)} · nächste: ${formatDate(r.nextDue)}`
          if (isDraft(r)) status = 'Betrag und Datum eintragen'
          else if (r.paused) status = 'Pausiert'
          else if (deadline && deadline >= today()) status += ` · kündbar bis ${formatDate(deadline)}`
          return (
            <button key={r.id} className="row" onClick={() => setEditing({ item: r })}>
              <CategoryIcon category={category} />
              <span className="row-main">
                <span className="row-title" style={{ display: 'block' }}>{r.name}</span>
                <span className={isDraft(r) ? 'row-sub tint' : 'row-sub'} style={{ display: 'block' }}>{status}</span>
              </span>
              <span className="row-value num">{isDraft(r) ? '–' : formatEuro(r.amount)}</span>
            </button>
          )
        })}
        <button className="row tint" onClick={() => setEditing({})}><Icon name="plus" size={20} /> Neues Abo</button>
      </div>

      <h2 className="section-title">Erinnerung</h2>
      <div className="group">
        <label className="row">
          <span className="row-main">Vorlaufzeit</span>
          <select aria-label="Vorlaufzeit der Erinnerung" value={lead} onChange={(e) => setMeta('reminderDays', Number(e.target.value))}>
            {LEAD.map(([value, label]) => <option key={value} value={value}>{label} vorher</option>)}
          </select>
        </label>
      </div>
      <p className="section-foot">
        Die Übersicht zeigt dir rechtzeitig vor einer Verlängerung und vor dem Ende der Kündigungsfrist einen Hinweis.
        Eine Web-App kann dir keine Mitteilung schicken, solange sie geschlossen ist. Mit „Erinnerung in den Kalender“ im Abo legst du deshalb einen wiederkehrenden Kalendertermin mit Erinnerung an.
      </p>
      {editing && <SubscriptionSheet item={editing.item} onClose={() => setEditing(null)} />}
    </SubPage>
  )
}
