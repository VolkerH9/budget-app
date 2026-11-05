import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context'
import { CodeFields } from '../components/LockGate'
import { Sheet, Switch } from '../components/ui'
import { faceIdAvailable, NoPrfError, registerFaceId } from '../lib/lock'
import { changeCode, disableFaceId, enableFaceId, getKeyring, setLockAfter, type Keyring } from '../lib/vault'
import { SubPage } from './Settings'

const LOCK_AFTER: [number, string][] = [[0, 'Sofort'], [60, 'Nach 1 Minute'], [300, 'Nach 5 Minuten'], [900, 'Nach 15 Minuten']]

function ChangeCodeSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useApp()
  const [old, setOld] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const onCode = useCallback((value: string | null) => setCode(value), [])

  const save = async () => {
    if (!code || !old) return
    setBusy(true)
    const ok = await changeCode(old, code)
    setBusy(false)
    if (!ok) {
      setMessage('Der bisherige Code stimmt nicht.')
      return
    }
    toast('Zugangscode geändert')
    onClose()
  }

  return (
    <Sheet title="Code ändern" onClose={onClose} full action={{ label: busy ? 'Prüfe …' : 'Sichern', disabled: !code || !old || busy, onClick: save }}>
      <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="group">
          <input type="text" name="username" autoComplete="username" value="Budget-App" readOnly hidden />
          <label className="row">
            <input className="left" type="password" autoComplete="current-password" placeholder="Bisheriger Code" aria-label="Bisheriger Code" value={old} onChange={(e) => setOld(e.target.value)} autoFocus />
          </label>
        </div>
        <p className="section-foot danger" role="status">{message}</p>
        <h3 className="section-title">Neuer Code</h3>
        <CodeFields onChange={onCode} />
      </form>
      <p className="section-foot">Deine Daten bleiben dabei unverändert. Notiere den neuen Code sicher, zum Beispiel in der Passwörter-App.</p>
    </Sheet>
  )
}

export function SecurityPage({ onBack }: { onBack: () => void }) {
  const { alert, toast } = useApp()
  const [ring, setRing] = useState<Keyring | null>(null)
  const [available, setAvailable] = useState(false)
  const [changing, setChanging] = useState(false)

  const reload = useCallback(() => { getKeyring().then((value) => setRing(value ?? null)) }, [])
  useEffect(() => {
    reload()
    faceIdAvailable().then(setAvailable)
  }, [reload])

  const toggleFaceId = async (on: boolean) => {
    if (!on) {
      await disableFaceId()
      reload()
      return
    }
    try {
      const { credentialId, salt, secret } = await registerFaceId()
      await enableFaceId(credentialId, salt, secret)
      toast('Face ID ist aktiv')
    } catch (error) {
      alert({
        title: 'Face ID nicht eingerichtet',
        message: error instanceof NoPrfError
          ? 'Dein iPhone gibt für Web-Apps kein Face-ID-Geheimnis heraus, mit dem sich die Daten entschlüsseln lassen. Du entsperrst weiter mit deinem Code.'
          : 'Der Vorgang wurde abgebrochen oder dein iPhone hat ihn abgelehnt. Prüfe, ob Face ID und der iCloud-Schlüsselbund aktiv sind. Dein Code funktioniert weiterhin.',
        buttons: [{ label: 'OK', style: 'strong' }],
      })
    }
    reload()
  }

  return (
    <SubPage title="Zugangscode und Face ID" onBack={onBack}>
      <div className="group">
        <div className="row">
          <span className="row-main">
            Mit Face ID entsperren
            {!available && <span className="row-sub" style={{ display: 'block' }}>Auf diesem Gerät nicht verfügbar</span>}
          </span>
          <Switch label="Face ID" checked={!!ring?.faceId} onChange={toggleFaceId} />
        </div>
        <label className="row">
          <span className="row-main">Sperren im Hintergrund</span>
          <select aria-label="Wann sperren" value={ring?.lockAfter ?? 300} onChange={async (e) => { await setLockAfter(Number(e.target.value)); reload() }}>
            {LOCK_AFTER.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button className="row tint" onClick={() => setChanging(true)}>Zugangscode ändern</button>
      </div>
      <p className="section-foot">Klappt Face ID nicht, entsperrst du die App immer mit deinem Code. Nach mehreren falschen Codes wartet die App immer länger, bis zu einer Stunde.</p>

      <h2 className="section-title">So sind deine Daten geschützt</h2>
      <div className="card prose">
        <p><b>Verschlüsselt:</b> Alle Einträge, Kategorien, Daueraufträge, Abos, Einstellungen und dein API-Schlüssel liegen mit AES-256 verschlüsselt auf diesem iPhone. Den Schlüssel dafür erzeugt die App aus deinem Code. Der Code selbst wird nirgends gespeichert.</p>
        <p><b>Die Web-Adresse ist öffentlich,</b> deine Daten aber nicht. Wer die Adresse öffnet, bekommt eine leere App mit eigenem Speicher auf seinem eigenen Gerät. Zu deinem iPhone gibt es keine Verbindung.</p>
        <p><b>Grenzen:</b> Solange die App entsperrt ist, sind die Daten im Arbeitsspeicher lesbar. Die Wartezeit nach falschen Codes schützt vor Raten in der App. Gegen jemanden, der den Speicher deines entsperrten iPhones kopiert, hilft nur ein langer Code mit Buchstaben und Zahlen. Exportierte Backups sind nicht verschlüsselt, bewahre sie sicher auf, etwa in iCloud Drive.</p>
        <p><b>Code vergessen?</b> Dann kann niemand die Daten entschlüsseln. Es bleibt nur „Code vergessen?“ auf dem Sperrbildschirm: Die App wird zurückgesetzt und du spielst dein letztes Backup ein. Sichere deshalb regelmäßig ein Backup.</p>
      </div>
      {changing && <ChangeCodeSheet onClose={() => setChanging(false)} />}
    </SubPage>
  )
}
