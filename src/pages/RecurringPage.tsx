import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, type EntryType, type Recurring } from '../db'
import { useApp, useCategories } from '../context'
import { Icon } from '../components/Icon'
import { TYPE_OPTIONS } from '../components/EntrySheet'
import { Segmented, Sheet, Switch } from '../components/ui'
import { CategoryIcon, categoryText } from '../components/CategoryIcon'
import { bookDueEntries, countBacklog, resumeNextDue } from '../lib/booking'
import { formatDate, today, WEEKDAYS } from '../lib/dates'
import { amountToInput, formatEuro, parseAmount } from '../lib/format'
import { firstOnOrAfter, type Interval } from '../lib/recurring'
import { SubPage } from './Settings'

const INTERVALS: [Interval, string][] = [['weekly', 'Wöchentlich'], ['monthly', 'Monatlich'], ['quarterly', 'Vierteljährlich'], ['yearly', 'Jährlich']]

const describe = (r: Recurring) => {
  const interval = INTERVALS.find(([key]) => key === r.interval)?.[1] ?? `Alle ${r.everyMonths} Monate`
  return r.interval === 'weekly' ? `${interval}, ${WEEKDAYS[r.bookingDay - 1]}` : `${interval}, am ${r.bookingDay}.`
}

function RecurringSheet({ item, onClose }: { item?: Recurring; onClose: () => void }) {
  const { alert, toast } = useApp()
  const categories = useCategories()
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? amountToInput(item.amount) : '')
  const [type, setType] = useState<EntryType>(item?.type ?? 'expense')
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '')
  const [interval, setInterval] = useState<Interval>(item?.interval ?? 'monthly')
  const [bookingDay, setBookingDay] = useState(item?.bookingDay ?? new Date().getDate())
  const [startDate, setStartDate] = useState(item?.startDate ?? today())
  const [endDate, setEndDate] = useState(item?.endDate ?? '')
  const [paused, setPaused] = useState(item?.paused ?? false)

  const list = categories.filter((c) => c.type === type)
  useEffect(() => {
    if (categories.length > 0 && !list.some((c) => c.id === categoryId)) setCategoryId(list[0]?.id ?? '')
  }, [categories.length, type]) // eslint-disable-line react-hooks/exhaustive-deps

  const cents = parseAmount(amount)
  const valid = !!name.trim() && cents !== null && !!categoryId && !!startDate && (!endDate || endDate >= startDate)

  const changeInterval = (next: Interval) => {
    if ((next === 'weekly') !== (interval === 'weekly')) setBookingDay(next === 'weekly' ? 1 : new Date().getDate())
    setInterval(next)
  }

  const save = async (catchUp: boolean) => {
    const values = { name: name.trim(), amount: cents!, type, categoryId, interval, bookingDay, startDate, endDate: endDate || undefined, paused }
    const scheduleChanged = item && (item.interval !== interval || item.bookingDay !== bookingDay || item.startDate !== startDate)
    let nextDue = item?.nextDue ?? firstOnOrAfter(values, catchUp ? startDate : today())
    if (scheduleChanged) nextDue = firstOnOrAfter(values, today())
    else if (item?.paused && !paused) nextDue = resumeNextDue({ ...item, ...values })
    const record = { ...values, id: item?.id ?? newId(), nextDue }
    await db.recurring.put(record)
    await bookDueEntries()
    toast('Dauerauftrag gespeichert')
    onClose()
  }

  const onSave = () => {
    const backlog = item ? 0 : countBacklog({ interval, bookingDay, startDate, endDate: endDate || undefined })
    if (backlog === 0) {
      save(true)
      return
    }
    alert({
      title: 'Rückwirkend buchen?',
      message: `Das Startdatum liegt in der Vergangenheit. Seitdem wären ${backlog === 1 ? '1 Eintrag' : `${backlog} Einträge`} fällig gewesen.`,
      buttons: [
        { label: backlog === 1 ? 'Nachbuchen' : `Alle ${backlog} nachbuchen`, style: 'strong', onClick: () => save(true) },
        { label: 'Erst ab heute buchen', onClick: () => save(false) },
        { label: 'Abbrechen' },
      ],
    })
  }

  const remove = () => alert({
    title: 'Dauerauftrag löschen?',
    message: 'Bereits gebuchte Einträge bleiben erhalten.',
    buttons: [
      { label: 'Löschen', style: 'destructive', onClick: async () => { await db.recurring.delete(item!.id); onClose() } },
      { label: 'Abbrechen', style: 'strong' },
    ],
  })

  return (
    <Sheet title={item ? 'Dauerauftrag' : 'Neuer Dauerauftrag'} onClose={onClose} full action={{ label: 'Sichern', disabled: !valid, onClick: onSave }}>
      <Segmented value={type} options={TYPE_OPTIONS} onChange={setType} />
      <div className="group" style={{ marginTop: 12 }}>
        <div className="row"><input className="left" type="text" placeholder="Name, z. B. Miete" aria-label="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <label className="row">
          <span className="row-main">Betrag</span>
          <input type="text" inputMode="decimal" placeholder="0,00" aria-label="Betrag in Euro" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="row-value">€</span>
        </label>
        <label className="row">
          <span className="row-main">Kategorie</span>
          <select aria-label="Kategorie" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {list.map((c) => <option key={c.id} value={c.id}>{categoryText(c)}</option>)}
          </select>
        </label>
      </div>
      <h3 className="section-title">Zeitplan</h3>
      <div className="group">
        <label className="row">
          <span className="row-main">Intervall</span>
          <select aria-label="Intervall" value={interval} onChange={(e) => changeInterval(e.target.value as Interval)}>
            {INTERVALS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="row">
          <span className="row-main">{interval === 'weekly' ? 'Wochentag' : 'Tag der Buchung'}</span>
          <select aria-label="Tag der Buchung" value={bookingDay} onChange={(e) => setBookingDay(Number(e.target.value))}>
            {interval === 'weekly'
              ? WEEKDAYS.map((day, i) => <option key={day} value={i + 1}>{day}</option>)
              : Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}.</option>)}
          </select>
        </label>
        <label className="row">
          <span className="row-main">Startdatum</span>
          <input type="date" aria-label="Startdatum" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="row">
          <span className="row-main">Enddatum (optional)</span>
          <input type="date" aria-label="Enddatum" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <p className="section-foot">
        Gibt es den Tag in einem Monat nicht, wird am letzten Tag des Monats gebucht.
        {interval === 'quarterly' && ' Vierteljährlich zählt ab dem Monat des Startdatums.'}
      </p>
      {item && (
        <>
          <div className="group" style={{ marginTop: 20 }}>
            <div className="row">
              <span className="row-main">Pausiert</span>
              <Switch label="Pausiert" checked={paused} onChange={setPaused} />
            </div>
          </div>
          <p className="section-foot">Eine Pause wird später nicht nachgebucht.</p>
          <button className="row center danger" style={{ marginTop: 20, borderRadius: 12 }} onClick={remove}>Dauerauftrag löschen</button>
        </>
      )}
    </Sheet>
  )
}

export function RecurringPage({ onBack }: { onBack: () => void }) {
  const categories = useCategories()
  const items = useLiveQuery(() => db.recurring.filter((r) => !r.subscription).toArray(), [], [] as Recurring[])
  const [editing, setEditing] = useState<{ item?: Recurring } | null>(null)
  const sorted = [...items].sort((a, b) => a.nextDue.localeCompare(b.nextDue))

  return (
    <SubPage title="Daueraufträge" onBack={onBack}>
      <div className="group">
        {sorted.map((r) => {
          const category = categories.find((c) => c.id === r.categoryId)
          const ended = !!r.endDate && r.nextDue > r.endDate
          return (
            <button key={r.id} className="row" onClick={() => setEditing({ item: r })}>
              <CategoryIcon category={category} />
              <span className="row-main">
                <span className="row-title" style={{ display: 'block' }}>{r.name}</span>
                <span className="row-sub" style={{ display: 'block' }}>
                  {r.paused ? 'Pausiert' : ended ? 'Beendet' : `${describe(r)} · nächste: ${formatDate(r.nextDue)}`}
                </span>
              </span>
              <span className="row-value num">{formatEuro(r.amount)}</span>
            </button>
          )
        })}
        <button className="row tint" onClick={() => setEditing({})}><Icon name="plus" size={20} /> Neuer Dauerauftrag</button>
      </div>
      <p className="section-foot">Fällige Daueraufträge werden beim Öffnen der App automatisch gebucht, auch rückwirkend. Abos verwaltest du unter Einstellungen › Abos.</p>
      {editing && <RecurringSheet item={editing.item} onClose={() => setEditing(null)} />}
    </SubPage>
  )
}
