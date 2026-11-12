import { useCallback, useEffect, useMemo, useState } from 'react'
import { db, isParentsRefund, requestPersistence, type Entry } from './db'
import { Icon, type IconName } from './components/Icon'
import { Alert, Toast } from './components/ui'
import { EntrySheet } from './components/EntrySheet'
import { AssignSheet } from './components/ParentsCard'
import { ReportSheet, type ReportKind } from './components/ReportSheet'
import { LabelDetail } from './components/Labels'
import { AffordSheet, type AffordDraft } from './components/AffordSheet'
import { WrappedPlayer } from './components/Wrapped'
import { Ctx, type AlertRequest, type AppContext, type SettingsPage, type Tab } from './context'
import { bookDueEntries } from './lib/booking'
import { monthLabel, monthOf, today } from './lib/dates'
import { saving } from './lib/vault'
import { Overview } from './pages/Overview'
import { Entries } from './pages/Entries'
import { Analysis } from './pages/Analysis'
import { Budgets } from './pages/Budgets'
import { Settings } from './pages/Settings'
import { LockGate } from './components/LockGate'


const TABS: [Tab, string, IconName][] = [
  ['overview', 'Übersicht', 'overview'],
  ['entries', 'Einträge', 'list'],
  ['analysis', 'Auswertung', 'chart'],
  ['budgets', 'Budgets', 'budget'],
]

function Booking({ onBooked }: { onBooked: (count: number) => void }) {
  useEffect(() => {
    const book = () => { bookDueEntries().then((count) => { if (count > 0) onBooked(count) }) }
    book()
    const onVisible = () => { if (document.visibilityState === 'visible') book() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [onBooked])
  return null
}

export function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [month, setMonth] = useState(monthOf(today()))
  const [sheet, setSheet] = useState<{ entry?: Entry; draft?: Partial<Entry>; key: number } | null>(null)
  const [afford, setAfford] = useState<{ draft?: AffordDraft; key: number } | null>(null)
  const [toast, setToast] = useState<{ text: string; onUndo?: () => void; id: number } | null>(null)
  const [alert, setAlert] = useState<AlertRequest | null>(null)
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null)
  const [refund, setRefund] = useState<Entry | null>(null)
  const [report, setReport] = useState<{ month?: string; kind?: ReportKind } | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [statementTarget, setStatementTarget] = useState<string | null>(null)
  const [wrapped, setWrapped] = useState<string | null>(null)
  const clearStatementTarget = useCallback(() => setStatementTarget(null), [])

  /** A new repayment from the parents asks which monthly statement it pays */
  const onSaved = useCallback((saved: Entry, before?: Entry) => {
    const isRefund = (e?: Entry) => !!e && isParentsRefund(e)
    if (isRefund(saved) && !isRefund(before)) setRefund(saved)
  }, [])

  const showToast = useCallback((text: string, onUndo?: () => void) => setToast({ text, onUndo, id: Date.now() }), [])
  const hideToast = useCallback(() => setToast(null), [])
  const clearSettingsPage = useCallback(() => setSettingsPage(null), [])
  const closeRefund = useCallback(() => setRefund(null), [])
  const onBooked = useCallback((count: number) => showToast(count === 1 ? '1 Eintrag aus Dauerauftrag oder Abo gebucht' : `${count} Einträge aus Daueraufträgen und Abos gebucht`), [showToast])

  useEffect(() => {
    requestPersistence()
    saving.onError = () => setAlert({
      title: 'Speichern fehlgeschlagen',
      message: 'Eine Änderung konnte nicht auf dem iPhone gespeichert werden. Ist der Speicher voll? Sichere zur Vorsicht ein Backup.',
      buttons: [{ label: 'OK', style: 'strong' }],
    })
  }, [])

  const ctx = useMemo<AppContext>(() => ({
    month,
    setMonth,
    openEntry: (entry, draft) => setSheet({ entry, draft, key: Date.now() }),
    openAfford: (draft) => setAfford({ draft, key: Date.now() }),
    deleteEntry: (entry) => {
      db.entries.delete(entry.id)
      showToast('Eintrag gelöscht', () => db.entries.put(entry))
    },
    toast: showToast,
    alert: setAlert,
    openSettings: (page) => {
      setSettingsPage(page ?? null)
      setTab('settings')
    },
    settingsPage,
    clearSettingsPage,
    openReport: (options) => setReport(options ?? {}),
    openLabel: setLabel,
    openTab: setTab,
    openStatement: (key) => { setStatementTarget(key); setTab('analysis') },
    statementTarget,
    clearStatementTarget,
    openWrapped: setWrapped,
  }), [month, showToast, settingsPage, clearSettingsPage, statementTarget, clearStatementTarget])

  return (
    <Ctx.Provider value={ctx}>
      <LockGate onSetupDone={(checked) => showToast(`App-Code aktiv, ${checked} Datensätze verschlüsselt und geprüft`)}>
        <div className="app">
          <Booking onBooked={onBooked} />
          {tab === 'overview' && <Overview />}
          {tab === 'entries' && <Entries />}
          {tab === 'analysis' && <Analysis />}
          {tab === 'budgets' && <Budgets />}
          {tab === 'settings' && <Settings />}
          <div className="bottom">
            {/* Four areas around the add button; Einstellungen sits as a round button in the page head */}
            <nav className="tabbar" aria-label="Hauptnavigation">
              {TABS.slice(0, 2).map(([key, label, icon]) => (
                <button key={key} className="tab" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
                  <Icon name={icon} size={24} />
                  <span>{label}</span>
                </button>
              ))}
              <button className="fab" aria-label="Neuer Eintrag" onClick={() => setSheet({ key: Date.now() })}><Icon name="plus" size={30} width={2.4} /></button>
              {TABS.slice(2).map(([key, label, icon]) => (
                <button key={key} className="tab" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
                  <Icon name={icon} size={24} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
          {sheet && <EntrySheet key={sheet.key} entry={sheet.entry} draft={sheet.draft} onClose={() => setSheet(null)} onSaved={onSaved} />}
          {wrapped && <WrappedPlayer period={{ kind: wrapped.length === 4 ? 'year' : 'month', key: wrapped }} title={wrapped.length === 4 ? wrapped : monthLabel(wrapped)} onClose={() => setWrapped(null)} />}
          {afford && <AffordSheet key={afford.key} draft={afford.draft} onClose={() => setAfford(null)} />}
          {refund && <AssignSheet refund={refund} onClose={closeRefund} />}
          {label && <LabelDetail id={label} onClose={() => setLabel(null)} />}
          {report && <ReportSheet month={report.month} kind={report.kind} onClose={() => setReport(null)} />}
          {toast && <Toast key={toast.id} text={toast.text} onUndo={toast.onUndo} onDone={hideToast} />}
          {alert && <Alert {...alert} onClose={() => setAlert(null)} />}
        </div>
      </LockGate>
    </Ctx.Provider>
  )
}
