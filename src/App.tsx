import { useCallback, useEffect, useMemo, useState } from 'react'
import { db, requestPersistence, type Entry } from './db'
import { Icon, type IconName } from './components/Icon'
import { Alert, Toast } from './components/ui'
import { EntrySheet } from './components/EntrySheet'
import { Ctx, type AlertRequest, type AppContext } from './context'
import { bookDueEntries } from './lib/booking'
import { monthOf, today } from './lib/dates'
import { Overview } from './pages/Overview'
import { Entries } from './pages/Entries'
import { Budgets } from './pages/Budgets'
import { Settings } from './pages/Settings'
import { LockGate } from './components/LockGate'

type Tab = 'overview' | 'entries' | 'budgets' | 'settings'

const TABS: [Tab, string, IconName][] = [
  ['overview', 'Übersicht', 'overview'],
  ['entries', 'Einträge', 'list'],
  ['budgets', 'Budgets', 'budget'],
  ['settings', 'Einstellungen', 'settings'],
]

export function App() {
  const [tab, setTab] = useState<Tab>('overview')
  const [month, setMonth] = useState(monthOf(today()))
  const [sheet, setSheet] = useState<{ entry?: Entry } | null>(null)
  const [toast, setToast] = useState<{ text: string; onUndo?: () => void; id: number } | null>(null)
  const [alert, setAlert] = useState<AlertRequest | null>(null)

  const showToast = useCallback((text: string, onUndo?: () => void) => setToast({ text, onUndo, id: Date.now() }), [])
  const hideToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    requestPersistence()
    const book = () => {
      bookDueEntries().then((count) => {
        if (count > 0) showToast(count === 1 ? '1 Eintrag aus Dauerauftrag gebucht' : `${count} Einträge aus Daueraufträgen gebucht`)
      })
    }
    book()
    const onVisible = () => { if (document.visibilityState === 'visible') book() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [showToast])

  const ctx = useMemo<AppContext>(() => ({
    month,
    setMonth,
    openEntry: (entry) => setSheet({ entry }),
    deleteEntry: (entry) => {
      db.entries.delete(entry.id)
      showToast('Eintrag gelöscht', () => db.entries.put(entry))
    },
    toast: showToast,
    alert: setAlert,
  }), [month, showToast])

  return (
    <Ctx.Provider value={ctx}>
      <LockGate>
        <div className="app">
          {tab === 'overview' && <Overview />}
          {tab === 'entries' && <Entries />}
          {tab === 'budgets' && <Budgets />}
          {tab === 'settings' && <Settings />}
          <div className="bottom">
            <nav className="tabbar" aria-label="Hauptnavigation">
              {TABS.map(([key, label, icon]) => (
                <button key={key} className="tab" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
                  <Icon name={icon} size={24} />
                  {label}
                </button>
              ))}
            </nav>
            <button className="fab" aria-label="Neuer Eintrag" onClick={() => setSheet({})}><Icon name="plus" size={30} width={2.4} /></button>
          </div>
          {sheet && <EntrySheet entry={sheet.entry} onClose={() => setSheet(null)} />}
          {toast && <Toast key={toast.id} text={toast.text} onUndo={toast.onUndo} onDone={hideToast} />}
          {alert && <Alert {...alert} onClose={() => setAlert(null)} />}
        </div>
      </LockGate>
    </Ctx.Provider>
  )
}
