import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, PARENTS_REFUND, setMeta, type Entry } from '../db'
import { useApp, useAskToShare, useCategories, useGroups, useMeta, useRangeEntries } from '../context'
import { saveFile } from '../lib/backup'
import { addMonths, formatDate, monthLabel, monthOf, monthRange, today } from '../lib/dates'
import { amountToInput, formatEuro, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { settledItems, type Statement } from '../lib/parents'
import { monthReport, parentsReport } from '../lib/pdf'
import { withoutParents } from '../lib/stats'
import { StatusBadge, useStatements } from './ParentsCard'
import { MonthPicker, Segmented, Sheet, Switch } from './ui'

export type ReportKind = 'parents' | 'month'

/** Months whose parents report was made or whose reminder was dismissed */
export const REPORT_DONE = 'parentsReportDone'

const countPhotos = (entries: Entry[]) => entries.reduce((n, e) => n + (e.photos?.length ?? 0), 0)

/** "Monatsabrechnung als PDF": the parents report or the full month, made on the iPhone and shared. */
export function ReportSheet({ month: initialMonth, kind: initialKind, onClose }: { month?: string; kind?: ReportKind; onClose: () => void }) {
  const { toast, alert } = useApp()
  const askToShare = useAskToShare()
  const categories = useCategories()
  const groups = useGroups()
  const storedName = useLiveQuery(async () => ((await db.meta.get('reportName'))?.value as string | undefined) ?? '', [])
  const withPhotos = useMeta('reportPhotos', false)
  const hide = useMeta('hideParents', false)
  const done = useMeta<string[]>(REPORT_DONE, [])
  const [kind, setKind] = useState<ReportKind>(initialKind ?? 'parents')
  const [month, setMonth] = useState(initialMonth ?? addMonths(monthOf(today()), -1))
  const [name, setName] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [from, to] = monthRange(month)
  const entries = useRangeEntries(from, to)
  const { book } = useStatements()
  const [payment, setPayment] = useState('')

  useEffect(() => { if (name === null && storedName !== undefined) setName(storedName) }, [storedName, name])

  const empty: Statement = { month, items: [], total: 0, paid: 0, open: 0, status: 'paid', payments: [], running: month >= monthOf(today()) }
  const statement = book.statements.find((st) => st.month === month) ?? empty
  const earlierOpen = book.statements.filter((st) => st.month < month).reduce((sum, st) => sum + st.open, 0)
  const settled = useMemo(() => settledItems(book), [book])
  const shown = withoutParents(entries, hide)

  // The payment field starts with what is open; a smaller amount is a partial payment
  useEffect(() => setPayment(statement.open > 0 ? amountToInput(statement.open) : ''), [month, statement.open])
  const photos = kind === 'parents' ? countPhotos(statement.items) : withPhotos ? countPhotos(shown) : 0

  const create = async () => {
    if (progress) return
    setProgress('PDF wird erstellt …')
    const own = (name ?? '').trim()
    if (own !== storedName) await setMeta('reportName', own)
    const onProgress = (n: number, total: number) => setProgress(`Belege ${n} von ${total} …`)
    const options = { name: own, created: formatDate(today()) }
    try {
      const blob = kind === 'parents'
        ? await parentsReport(statement, { ...options, earlierOpen, settled }, onProgress)
        : await monthReport(month, shown, categories, groups, { ...options, photos: withPhotos, hiddenParents: hide }, onProgress)
      setProgress('Bereit zum Teilen …')
      const file = kind === 'parents' ? `Abrechnung-Eltern-${month}.pdf` : `Monatsbericht-${month}.pdf`
      const shared = await saveFile(file, blob, 'application/pdf', askToShare)
      if (shared && kind === 'parents' && !done.includes(month)) await setMeta(REPORT_DONE, [...done, month].slice(-36))
      if (shared) toast('PDF erstellt')
    } catch (error) {
      console.error(error)
      alert({ title: 'PDF nicht möglich', message: 'Bitte versuche es noch einmal. Bei sehr vielen Fotos hilft es, die App neu zu starten.', buttons: [{ label: 'OK', style: 'strong' }] })
    } finally {
      setProgress(null)
    }
  }

  const cents = parseAmount(payment)
  const bookPayment = async () => {
    if (cents === null) return
    await db.entries.add({
      id: newId(), type: 'income', amount: cents, categoryId: PARENTS_REFUND, date: today(), forMonth: month,
      note: `Abrechnung ${monthLabel(month)}`, createdAt: Date.now(),
    })
    haptic()
    const left = statement.open - cents
    toast(left > 0 ? `Teilzahlung gebucht, noch ${formatEuro(left)} offen` : 'Abrechnung ganz bezahlt')
  }

  return (
    <Sheet title="Monatsabrechnung" onClose={onClose} full>
      <Segmented<ReportKind> value={kind} options={[['parents', 'Eltern-Abrechnung'], ['month', 'Monatsbericht']]} onChange={setKind} />
      <div style={{ height: 6 }} />
      <MonthPicker month={month} onChange={setMonth} />

      {kind === 'parents'
        ? (
          <div className="card report-preview">
            <span className="row-sub">Abrechnung Eltern – {monthLabel(month)} {statement.items.length > 0 && <StatusBadge statement={statement} />}</span>
            <dl className="report-lines num">
              <dt>Ausgaben ({statement.items.length} Posten)</dt><dd>{formatEuro(statement.total)}</dd>
              <dt>Bereits bezahlt</dt><dd>{statement.paid > 0 ? `−${formatEuro(statement.paid)}` : formatEuro(0)}</dd>
              {statement.payments.map((p) => <Fragment key={p.refund.id}><dt className="report-payment">am {formatDate(p.refund.date)}</dt><dd className="report-payment">{formatEuro(p.amount)}</dd></Fragment>)}
            </dl>
            <div className="report-open">
              <span>{statement.items.length > 0 && statement.status === 'paid' ? 'Ganz bezahlt' : 'Offener Betrag'}</span>
              <strong className="num">{formatEuro(statement.items.length > 0 && statement.status === 'paid' ? statement.paid : statement.open)}</strong>
            </div>
            {earlierOpen > 0 && <span className="row-sub">Aus früheren Abrechnungen noch offen: {formatEuro(earlierOpen)}</span>}
            {statement.running && statement.items.length > 0 && <span className="row-sub">Der Monat läuft noch, neue Eltern-Ausgaben kommen dazu.</span>}
            <span className="row-sub">{photos === 0 ? 'Keine Belegfotos' : `${photos} ${photos === 1 ? 'Belegfoto' : 'Belegfotos'} im Anhang`}</span>
          </div>
        )
        : (
          <>
            <div className="card report-preview">
              <span className="row-sub">Monatsbericht {monthLabel(month)}</span>
              <span className="report-count">{shown.length} {shown.length === 1 ? 'Buchung' : 'Buchungen'}, gruppiert nach Über- und Unterkategorie, mit Einnahmen, Ausgaben, Sparen, Rest und Sparquote</span>
            </div>
            <div className="group">
              <div className="row">
                <span className="row-main">
                  Belegfotos anhängen
                  <span className="row-sub" style={{ display: 'block' }}>{countPhotos(shown) === 0 ? 'In diesem Monat gibt es keine' : `${countPhotos(shown)} ${countPhotos(shown) === 1 ? 'Foto' : 'Fotos'}`}</span>
                </span>
                <Switch label="Belegfotos anhängen" checked={withPhotos} onChange={(value) => setMeta('reportPhotos', value)} />
              </div>
            </div>
          </>
        )}

      <h3 className="section-title">Auf der Abrechnung</h3>
      <div className="group">
        <label className="row">
          <span className="row-main">Dein Name</span>
          <input type="text" placeholder="optional" aria-label="Dein Name" value={name ?? ''} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>

      <div style={{ height: 16 }} />
      <button className="primary-btn" disabled={!!progress} onClick={create}>{progress ?? 'PDF erstellen und teilen'}</button>
      <p className="section-foot">Das PDF entsteht auf dem iPhone. Über das Teilen-Menü schickst du es per WhatsApp oder Mail oder sicherst es in Dateien.</p>

      {kind === 'parents' && statement.open > 0 && (
        <>
          <h3 className="section-title">Zahlung deiner Eltern</h3>
          <div className="group">
            <label className="row">
              <span className="row-main">Betrag in €</span>
              <input type="text" inputMode="decimal" aria-label="Gezahlter Betrag" value={payment} onChange={(e) => setPayment(e.target.value)} />
            </label>
            <button className="row center tint row-sep" disabled={cents === null} style={cents === null ? { opacity: 0.4 } : undefined} onClick={bookPayment}>
              {cents !== null && cents < statement.open ? 'Teilzahlung buchen' : 'Als bezahlt buchen'}
            </button>
          </div>
          <p className="section-foot">Bucht den Betrag als Einnahme in „Kostenrückzahlung Eltern“ für diese Abrechnung. Für eine Teilzahlung den Betrag ändern. Ist die Abrechnung ganz bezahlt, gelten alle ihre Posten als erstattet.</p>
        </>
      )}
      <div style={{ height: 24 }} />
    </Sheet>
  )
}
