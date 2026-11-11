import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, requestPersistence, setMeta } from '../db'
import { useApp, useCategories, useGroups, useMeta, type SettingsPage } from '../context'
import { Icon } from '../components/Icon'
import { Segmented, Sheet, Switch } from '../components/ui'
import { BackupImport } from '../components/BackupImport'
import { LabelsList } from '../components/Labels'
import { useBackupExport } from '../components/BackupExport'
import { backupName, saveFile, toCsv } from '../lib/backup'
import { formatTime } from '../lib/dates'
import { expectSystemDialog } from '../lib/lockGuard'
import { hasSampleData, loadSampleData, removeSampleData } from '../lib/sample'
import { totals } from '../lib/subscriptions'
import { setTheme, useTheme, type Theme } from '../lib/theme'
import { amountToInput, formatEuro, parseAmount } from '../lib/format'
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
          <span className="row-main">Gescannten Beleg als Foto anhängen</span>
          <Switch label="Gescannten Beleg als Foto anhängen" checked={saveThumbnails} onChange={(value) => setMeta('saveThumbnails', value)} />
        </div>
      </div>
      <p className="section-foot">
        Beim Scan wird das verkleinerte Foto an Anthropic geschickt. Ist der Schalter an, hängt die App das Foto verkleinert und verschlüsselt an den Eintrag.
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

/** Hourly wage, so "Kann ich mir das leisten?" can say how many hours of work a purchase is */
function WageSheet({ onClose }: { onClose: () => void }) {
  const wage = useMeta<number | null>('hourlyWage', null)
  const [text, setText] = useState('')
  useEffect(() => setText(wage === null ? '' : amountToInput(wage)), [wage])
  const cents = text.trim() ? parseAmount(text) : null
  const valid = text.trim() === '' || cents !== null
  return (
    <Sheet title="Stundenlohn" onClose={onClose} action={{ label: 'Sichern', disabled: !valid, onClick: async () => { await setMeta('hourlyWage', cents); onClose() } }}>
      <div className="group">
        <label className="row">
          <span className="row-main">Netto pro Stunde in €</span>
          <input type="text" inputMode="decimal" placeholder="z. B. 14" aria-label="Stundenlohn" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
      </div>
      <p className="section-foot">„Kann ich mir das leisten?“ zeigt damit, wie viele Arbeitsstunden ein Kauf kostet. Leer lassen zum Ausschalten.</p>
    </Sheet>
  )
}

export function Settings() {
  const { alert, toast, settingsPage, clearSettingsPage, openReport, openLabel } = useApp()
  const labelCount = useLiveQuery(() => db.labels.filter((l) => !l.archived).count(), [], 0)
  const categories = useCategories()
  const groups = useGroups()
  const [sub, setSub] = useState<Sub>(settingsPage)
  const [goalOpen, setGoalOpen] = useState(false)
  const [wageOpen, setWageOpen] = useState(false)
  const wage = useMeta<number | null>('hourlyWage', null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const goal = useMeta<number | null>('savingsGoal', null)
  const apiKey = useMeta('apiKey', '')
  const lastBackup = useMeta<number | null>('lastBackupAt', null)
  const preUpdate = useMeta<unknown>('preUpdateBackup', null)
  const backupReminder = useMeta('backupReminder', true)
  const backupDay = useMeta('backupDay', 1)
  const parentsReminder = useMeta('parentsReminder', true)
  const backup = useBackupExport()
  const theme = useTheme()
  const standing = useLiveQuery(() => db.recurring.filter((r) => !r.subscription).count(), [], 0)
  const subscriptions = useLiveQuery(() => db.recurring.filter((r) => !!r.subscription).toArray(), [], [])
  const sample = useLiveQuery(hasSampleData, [], false)
  const [importing, setImporting] = useState<File | null>(null)
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
  if (sub === 'labels') return <SubPage title="Labels" onBack={() => setSub(null)}><LabelsList onOpen={openLabel} /></SubPage>

  const fail = (error: unknown) => alert({ title: 'Das hat nicht geklappt', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })

  const exportPreUpdate = () => saveFile(`budget-backup-vor-update.json`, JSON.stringify(preUpdate), 'application/json').catch(fail)

  const exportCsv = async () => {
    const entries = await db.entries.orderBy('date').toArray()
    await saveFile(backupName('csv'), toCsv(entries, categories, groups, await db.labels.toArray()), 'text/csv').catch(fail)
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
        <NavRow label="Labels" value={String(labelCount)} onClick={() => setSub('labels')} />
        <NavRow label="Abos" value={`${formatEuro(totals(subscriptions).month)} / Monat`} onClick={() => setSub('subscriptions')} />
        <NavRow label="Daueraufträge" value={String(standing)} onClick={() => setSub('recurring')} />
        <NavRow label="Sparziel" value={goal === null ? 'Aus' : `${goal} %`} onClick={() => setGoalOpen(true)} />
        <NavRow label="Stundenlohn" value={wage === null ? 'Aus' : `${formatEuro(wage)} / Std.`} onClick={() => setWageOpen(true)} />
      </div>

      <h2 className="section-title">App</h2>
      <div className="group">
        <NavRow label="Face ID & Code" onClick={() => setSub('security')} />
        <NavRow label="Design" value={theme === 'hud' ? 'HUD' : 'Standard'} onClick={() => setSub('design')} />
        <NavRow label="Belegscan" value={apiKey ? 'Eingerichtet' : 'Nicht eingerichtet'} onClick={() => setSub('scan')} />
      </div>

      <h2 className="section-title">Abrechnung</h2>
      <div className="group">
        <NavRow label="Monatsabrechnung als PDF" onClick={() => openReport()} />
        <div className="row">
          <span className="row-main">
            Erinnerung Eltern-Abrechnung
            <span className="row-sub" style={{ display: 'block' }}>Am Monatsende in der Übersicht</span>
          </span>
          <Switch label="Erinnerung Eltern-Abrechnung" checked={parentsReminder} onChange={(value) => setMeta('parentsReminder', value)} />
        </div>
      </div>

      <h2 className="section-title">Backup</h2>
      <div className="group">
        <button className="row tint" disabled={backup.busy} onClick={backup.run}>
          <span className="row-main">{backup.busy ? 'Backup wird erstellt …' : 'Backup exportieren'}</span>
        </button>
        <div className="row">
          <span className="row-main">Letztes Backup</span>
          <span className="row-value">{lastBackup ? formatTime(lastBackup) : 'Noch nie'}</span>
        </div>
        <div className="row">
          <span className="row-main">Monatliche Erinnerung</span>
          <Switch label="Monatliche Backup-Erinnerung" checked={backupReminder} onChange={(value) => setMeta('backupReminder', value)} />
        </div>
        {backupReminder && (
          <label className="row">
            <span className="row-main">Erinnerungstag</span>
            <select aria-label="Erinnerungstag" value={backupDay} onChange={(e) => setMeta('backupDay', Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => <option key={day} value={day}>{day}. des Monats</option>)}
            </select>
          </label>
        )}
        <button className="row tint" onClick={() => { expectSystemDialog(); importer.current?.click() }}>Backup importieren</button>
        <button className="row tint" onClick={exportCsv}>Als CSV exportieren (Excel, Numbers)</button>
        {!!preUpdate && <button className="row tint" onClick={exportPreUpdate}>Sicherung von vor dem Update exportieren</button>}
      </div>
      <p className="section-foot">
        Deine Daten liegen nur auf diesem iPhone. Das Backup enthält alle Einträge und Belegfotos und ist mit deinem App-Code verschlüsselt.
        Zum Einspielen brauchst du den App-Code, der beim Erstellen galt. API-Schlüssel und App-Code selbst stehen nicht darin.
        Speichere es in iCloud Drive. Die CSV-Datei ist nicht verschlüsselt und enthält keine Fotos.
      </p>
      <input ref={importer} type="file" accept="application/json,.json" hidden onChange={(e) => { setImporting(e.target.files?.[0] ?? null); e.target.value = '' }} />
      {importing && <BackupImport file={importing} onClose={() => setImporting(null)} />}

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
      {wageOpen && <WageSheet onClose={() => setWageOpen(false)} />}
    </main>
  )
}
