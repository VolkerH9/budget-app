import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, PARENT_CATEGORIES, PARENTS_REFUND, setMeta, type Entry } from '../db'
import { useApp, useAskToShare, useCategories, useGroups, useMeta, useRangeEntries } from '../context'
import { saveFile } from '../lib/backup'
import { addMonths, formatDate, monthLabel, monthOf, monthRange, today } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { haptic } from '../lib/haptics'
import { parentsStatement } from '../lib/parents'
import { monthReport, parentsReport } from '../lib/pdf'
import { parentsBalance, withoutParents } from '../lib/stats'
import { MonthPicker, Segmented, Sheet, Switch } from './ui'

export type ReportKind = 'parents' | 'month'

/** Months whose parents report was made or whose reminder was dismissed */
export const REPORT_DONE = 'parentsReportDone'

const items = (n: number) => (n === 1 ? '1 offener Posten' : `${n} offene Posten`)

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
  const parents = useLiveQuery(() => db.entries.where('categoryId').anyOf(PARENT_CATEGORIES).toArray(), [], [] as Entry[])

  useEffect(() => { if (name === null && storedName !== undefined) setName(storedName) }, [storedName, name])

  const statement = useMemo(() => parentsStatement(parents.filter((e) => e.date <= to), month), [parents, month, to])
  // Repayments after the month end are not on the report, but the user should see what is open today
  const openToday = useMemo(() => parentsBalance(parents).open, [parents])
  const shown = withoutParents(entries, hide)
  const openItems = statement.items.filter((e) => !e.refunded)
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
        ? await parentsReport(statement, options, onProgress)
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

  const markAll = () => {
    const open = openItems.reduce((sum, e) => sum + e.amount, 0)
    const tick = async (book: boolean) => {
      await db.entries.bulkUpdate(openItems.map((e) => ({ key: e.id, changes: { refunded: true } })))
      if (book) {
        await db.entries.add({
          id: newId(), type: 'income', amount: statement.open, categoryId: PARENTS_REFUND, date: today(),
          note: `Abrechnung ${monthLabel(month)}`, createdAt: Date.now(),
        })
      }
      haptic()
      toast(book ? `Markiert, ${formatEuro(statement.open)} als Rückzahlung gebucht` : `${openItems.length} Posten als erstattet markiert`)
    }
    alert({
      title: 'Alle Posten als erstattet markieren?',
      message: statement.open > 0
        ? `${items(openItems.length)} über ${formatEuro(open)}. Hast du die Rückzahlung schon gebucht, wähle „Nur markieren“. Sonst bucht die App den offenen Betrag von ${formatEuro(statement.open)} als Einnahme in „Kostenrückzahlung Eltern“, damit „Offen von Eltern“ stimmt.`
        : `${items(openItems.length)} über ${formatEuro(open)}.`,
      buttons: [
        ...(statement.open > 0 ? [{ label: `${formatEuro(statement.open)} buchen und markieren`, onClick: () => { tick(true) } }] : []),
        { label: 'Nur markieren', onClick: () => { tick(false) } },
        { label: 'Abbrechen', style: 'strong' as const },
      ],
    })
  }

  return (
    <Sheet title="Monatsabrechnung" onClose={onClose} full>
      <Segmented<ReportKind> value={kind} options={[['parents', 'Eltern-Abrechnung'], ['month', 'Monatsbericht']]} onChange={setKind} />
      <div style={{ height: 6 }} />
      <MonthPicker month={month} onChange={setMonth} />

      {kind === 'parents'
        ? (
          <div className="card report-preview">
            <span className="row-sub">Abrechnung Eltern – {monthLabel(month)}</span>
            <dl className="report-lines num">
              <dt>Ausgaben ({statement.items.length} Posten)</dt><dd>{formatEuro(statement.spent)}</dd>
              <dt>Rückzahlungen im Monat</dt><dd>{statement.refunds > 0 ? `−${formatEuro(statement.refunds)}` : formatEuro(0)}</dd>
              {statement.carry !== 0 && <><dt>{statement.carry > 0 ? 'Offen aus Vormonaten' : 'Guthaben aus Vormonaten'}</dt><dd>{statement.carry > 0 ? formatEuro(statement.carry) : `−${formatEuro(-statement.carry)}`}</dd></>}
            </dl>
            <div className="report-open">
              <span>{statement.open >= 0 ? 'Offener Betrag' : 'Zu viel erstattet'}</span>
              <strong className="num">{formatEuro(Math.abs(statement.open))}</strong>
            </div>
            {openToday !== statement.open && month < monthOf(today()) && <span className="row-sub">Stand Monatsende. Heute noch offen: {formatEuro(openToday)}</span>}
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

      {kind === 'parents' && openItems.length > 0 && (
        <>
          <div style={{ height: 8 }} />
          <button className="secondary-btn wide" onClick={markAll}>Alle Posten dieser Abrechnung als erstattet markieren</button>
          <p className="section-foot">Zum Beispiel, nachdem deine Eltern den Betrag überwiesen haben.</p>
        </>
      )}
      <div style={{ height: 24 }} />
    </Sheet>
  )
}
