import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, requestPersistence, setMeta } from '../db'
import { useApp, useCategories, useGroups, useMeta, type SettingsPage } from '../context'
import { Icon } from '../components/Icon'
import { Segmented, Sheet, Switch } from '../components/ui'
import { backupName, createBackup, markBackupDone, parseBackup, restoreBackup, saveFile, toCsv } from '../lib/backup'
import { bookDueEntries } from '../lib/booking'
import { expectSystemDialog } from '../lib/lockGuard'
import { hasSampleData, loadSampleData, removeSampleData } from '../lib/sample'
import { totals } from '../lib/subscriptions'
import { setTheme, useTheme, type Theme } from '../lib/theme'
import { formatEuro } from '../lib/format'
import { CategoriesPage } from './CategoriesPage'
import { RecurringPage } from './RecurringPage'
import { SecurityPage } from './SecurityPage'
import { SubscriptionsPage } from './SubscriptionsPage'

type Sub = SettingsPage | null

function DesignPage({ onBack }: { onBack: () => void }) {
  const theme = useTheme()
  return (
    <SubPage title="Design" onBack={onBack}>
      <Segmented<Theme> value={theme} options={[['standard', 'Standard'], ['hud', 'HUD']]} onChange={setTheme} />
      <p className="section-foot">
        <b>Standard</b> folgt dem hellen oder dunklen Modus deines iPhones.
        <b> HUD</b> ist ein dunkles Design mit dünnen, leuchtenden Linien und Ringen mit Skala, wie ein Head-up-Display.
      </p>
    </SubPage>
  )
}

const daysAgo = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000)
  return days === 0 ? 'Heute' : days === 1 ? 'Gestern' : `Vor ${days} Tagen`
}

export function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <main className="page">
      <div className="subpage-nav">
        <button className="back" onClick={onBack}><Icon name="left" size={22} /> Einstellungen</button>
      </div>
      <h1 className="page-title">{title}</h1>
      {children}
    </main>
  )
}

function ScanPage({ onBack }: { onBack: () => void }) {
  const { toast } = useApp()
  const stored = useMeta('apiKey', '')
  const saveThumbnails = useMeta('saveThumbnails', true)
  const [key, setKey] = useState('')
  useEffect(() => setKey(stored), [stored])

  const save = async () => {
    await setMeta('apiKey', key.trim())
    toast(key.trim() ? 'API-Schlüssel gespeichert' : 'API-Schlüssel entfernt')
  }

  return (
    <SubPage title="Belegscan" onBack={onBack}>
      <h2 className="section-title">Claude-API-Schlüssel</h2>
      <div className="group">
        <div className="row">
          <input className="left" type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="sk-ant-…" aria-label="API-Schlüssel" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <button className="row center tint row-sep" disabled={key.trim() === stored} style={key.trim() === stored ? { opacity: 0.4 } : undefined} onClick={save}>Speichern</button>
      </div>
      <p className="section-foot">
        Der Schlüssel bleibt auf diesem iPhone. Er steht nicht im Backup und nicht im Programmcode.
        Du bekommst ihn unter console.anthropic.com › API Keys.
      </p>
      <h2 className="section-title">Fotos</h2>
      <div className="group">
        <div className="row">
          <span className="row-main">Miniatur beim Eintrag speichern</span>
          <Switch label="Miniatur speichern" checked={saveThumbnails} onChange={(value) => setMeta('saveThumbnails', value)} />
        </div>
      </div>
      <p className="section-foot">
        Beim Scan wird das verkleinerte Foto an Anthropic geschickt. Das Originalfoto wird nicht in der App gespeichert.
        Ein Scan kostet etwa 0,05 bis 0,1 Cent.
      </p>
    </SubPage>
  )
}

function GoalSheet({ onClose }: { onClose: () => void }) {
  const goal = useMeta<number | null>('savingsGoal', null)
  const [text, setText] = useState('')
  useEffect(() => setText(goal === null ? '' : String(goal)), [goal])
  const value = Number(text)
  const valid = text === '' || (Number.isInteger(value) && value >= 0 && value <= 100)
  return (
    <Sheet title="Sparziel" onClose={onClose} action={{ label: 'Sichern', disabled: !valid, onClick: async () => { await setMeta('savingsGoal', text === '' ? null : value); onClose() } }}>
      <div className="group">
        <label className="row">
          <span className="row-main">Sparquote in %</span>
          <input type="number" inputMode="numeric" min={0} max={100} placeholder="z. B. 20" aria-label="Sparziel in Prozent" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
      </div>
      <p className="section-foot">Leer lassen, um kein Sparziel zu verwenden.</p>
    </Sheet>
  )
}

export function Settings() {
  const { alert, toast, settingsPage, clearSettingsPage } = useApp()
  const categories = useCategories()
  const groups = useGroups()
  const [sub, setSub] = useState<Sub>(settingsPage)
  const [goalOpen, setGoalOpen] = useState(false)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const goal = useMeta<number | null>('savingsGoal', null)
  const apiKey = useMeta('apiKey', '')
  const lastBackup = useMeta<number | null>('lastBackupAt', null)
  const preUpdate = useMeta<unknown>('preUpdateBackup', null)
  const theme = useTheme()
  const standing = useLiveQuery(() => db.recurring.filter((r) => !r.subscription).count(), [], 0)
  const subscriptions = useLiveQuery(() => db.recurring.filter((r) => !!r.subscription).toArray(), [], [])
  const sample = useLiveQuery(hasSampleData, [], false)
  const importer = useRef<HTMLInputElement>(null)

  useEffect(() => { requestPersistence().then(setPersisted) }, [])
  useEffect(() => {
    if (settingsPage) {
      setSub(settingsPage)
      clearSettingsPage()
    }
  }, [settingsPage, clearSettingsPage])

  if (sub === 'categories') return <CategoriesPage onBack={() => setSub(null)} />
  if (sub === 'recurring') return <RecurringPage onBack={() => setSub(null)} />
  if (sub === 'subscriptions') return <SubscriptionsPage onBack={() => setSub(null)} />
  if (sub === 'security') return <SecurityPage onBack={() => setSub(null)} />
  if (sub === 'scan') return <ScanPage onBack={() => setSub(null)} />
  if (sub === 'design') return <DesignPage onBack={() => setSub(null)} />

  const fail = (error: unknown) => alert({ title: 'Das hat nicht geklappt', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })

  const exportJson = () => createBackup()
    .then((backup) => saveFile(backupName('json'), JSON.stringify(backup), 'application/json'))
    .then(markBackupDone)
    .catch(fail)

  const exportPreUpdate = () => saveFile(`budget-backup-vor-update.json`, JSON.stringify(preUpdate), 'application/json').catch(fail)

  const exportCsv = async () => {
    const entries = await db.entries.orderBy('date').toArray()
    await saveFile(backupName('csv'), toCsv(entries, categories, groups), 'text/csv').catch(fail)
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    if (importer.current) importer.current.value = ''
    try {
      const backup = parseBackup(await file.text())
      alert({
        title: 'Backup einspielen?',
        message: `${backup.entries.length} Einträge vom ${new Date(backup.exportedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}. Alle aktuellen Einträge, Kategorien, Daueraufträge und Abos werden ersetzt.`,
        buttons: [
          { label: 'Ersetzen', style: 'destructive', onClick: () => restoreBackup(backup).then(() => bookDueEntries()).then(() => toast('Backup eingespielt')).catch(fail) },
          { label: 'Abbrechen', style: 'strong' },
        ],
      })
    } catch (error) {
      fail(error)
    }
  }

  const NavRow = ({ label, value, onClick }: { label: string; value?: string; onClick: () => void }) => (
    <button className="row" onClick={onClick}>
      <span className="row-main">{label}</span>
      {value && <span className="row-value">{value}</span>}
      <span className="chevron"><Icon name="right" size={16} /></span>
    </button>
  )

  return (
    <main className="page">
      <h1 className="page-title">Einstellungen</h1>

      <h2 className="section-title">Planung</h2>
      <div className="group">
        <NavRow label="Kategorien" value={String(categories.length)} onClick={() => setSub('categories')} />
        <NavRow label="Abos" value={`${formatEuro(totals(subscriptions).month)} / Monat`} onClick={() => setSub('subscriptions')} />
        <NavRow label="Daueraufträge" value={String(standing)} onClick={() => setSub('recurring')} />
        <NavRow label="Sparziel" value={goal === null ? 'Aus' : `${goal} %`} onClick={() => setGoalOpen(true)} />
      </div>

      <h2 className="section-title">App</h2>
      <div className="group">
        <NavRow label="Zugangscode und Face ID" onClick={() => setSub('security')} />
        <NavRow label="Design" value={theme === 'hud' ? 'HUD' : 'Standard'} onClick={() => setSub('design')} />
        <NavRow label="Belegscan" value={apiKey ? 'Eingerichtet' : 'Nicht eingerichtet'} onClick={() => setSub('scan')} />
      </div>

      <h2 className="section-title">Backup</h2>
      <div className="group">
        <button className="row tint" onClick={exportJson}>
          <span className="row-main">Backup exportieren</span>
          <span className="row-value" style={{ fontSize: 15 }}>{lastBackup ? daysAgo(lastBackup) : 'Noch nie'}</span>
        </button>
        <button className="row tint" onClick={() => { expectSystemDialog(); importer.current?.click() }}>Backup importieren</button>
        <button className="row tint" onClick={exportCsv}>Als CSV exportieren (Excel, Numbers)</button>
        {!!preUpdate && <button className="row tint" onClick={exportPreUpdate}>Sicherung von vor dem Update exportieren</button>}
      </div>
      <p className="section-foot">
        Deine Daten liegen nur auf diesem iPhone. Das Backup ist der einzige Weg zurück, falls du deinen Zugangscode vergisst oder das Handy wechselst. Speichere es regelmäßig in iCloud Drive.
        Das Backup selbst ist nicht verschlüsselt. API-Schlüssel und Zugangscode sind nicht enthalten.
      </p>
      <input ref={importer} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />

      <h2 className="section-title">Beispieldaten</h2>
      <div className="group">
        {sample
          ? <button className="row danger" onClick={() => removeSampleData().then(() => toast('Beispieldaten gelöscht'))}>Beispieldaten löschen</button>
          : <button className="row tint" onClick={() => loadSampleData().then(() => toast('Beispieldaten geladen'))}>Beispieldaten laden</button>}
      </div>
      <p className="section-foot">Beispieldaten sind markiert. Beim Löschen bleiben deine eigenen Einträge erhalten.</p>

      <h2 className="section-title">Speicher</h2>
      <div className="group">
        <div className="row">
          <span className="row-main">Dauerhafter Speicher</span>
          <span className="row-value">{persisted === null ? '…' : persisted ? 'Aktiv' : 'Nicht bestätigt'}</span>
        </div>
      </div>
      {persisted === false && <p className="section-foot">iOS bestätigt den dauerhaften Speicher erst, wenn die App auf dem Home-Bildschirm liegt. Sichere trotzdem regelmäßig ein Backup.</p>}

      {goalOpen && <GoalSheet onClose={() => setGoalOpen(false)} />}
    </main>
  )
}
