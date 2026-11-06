import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context'
import { CodeFields } from '../components/LockGate'
import { Sheet, Switch } from '../components/ui'
import { faceIdAvailable, registerFaceId } from '../lib/lock'
import { changeCode, checkCode, closeSession, getKeyring, isSignedIn, setLockAfter, signIn, signOut, whenSaved, type Keyring } from '../lib/vault'
import { SubPage } from './Settings'

const LOCK_AFTER: [string, string][] = [['never', 'Nie'], ['0', 'Sofort'], ['60', 'Nach 1 Minute'], ['300', 'Nach 5 Minuten'], ['900', 'Nach 15 Minuten']]

/** The app is unlocked, so a new code needs no old one. That way a forgotten code can be replaced. */
function ChangeCodeSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useApp()
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const onCode = useCallback((value: string | null) => setCode(value), [])

  const save = async () => {
    if (!code) return
    setBusy(true)
    await changeCode(code)
    toast('App-Code geändert')
    onClose()
  }

  return (
    <Sheet title="App-Code ändern" onClose={onClose} full action={{ label: busy ? 'Sichere …' : 'Sichern', disabled: !code || busy, onClick: save }}>
      <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <CodeFields onChange={onCode} autoFocus />
      </form>
      <p className="section-foot">Den bisherigen App-Code brauchst du dafür nicht, weil die App gerade entsperrt ist. Deine Daten bleiben unverändert. Notiere den neuen App-Code sicher, zum Beispiel in der Passwörter-App.</p>
    </Sheet>
  )
}

/** Asks for the code first, so nobody signs out without being able to get back in. */
function SignOutSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!code || busy) return
    setBusy(true)
    if (!(await checkCode(code))) {
      setBusy(false)
      setMessage('Der App-Code stimmt nicht.')
      return
    }
    await signOut()
    await whenSaved()
    closeSession()
    location.reload()
  }

  return (
    <Sheet title="Gerät abmelden" onClose={onClose} full action={{ label: busy ? 'Prüfe …' : 'Abmelden', disabled: !code || busy, onClick: confirm }}>
      <p className="section-foot" style={{ marginTop: 0 }}>
        Danach öffnet sich Budget auf diesem iPhone nur noch mit deinem App-Code. Deine Daten bleiben verschlüsselt hier gespeichert. Zur Sicherheit gibst du den App-Code jetzt einmal ein, damit du sicher wieder hineinkommst.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); confirm() }}>
        <div className="group">
          <input type="text" name="username" autoComplete="username" value="Budget-App" readOnly hidden />
          <label className="row">
            <input className="left" type="password" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              placeholder="App-Code" aria-label="App-Code" value={code} onChange={(e) => { setCode(e.target.value); setMessage('') }} autoFocus />
          </label>
        </div>
      </form>
      <p className="section-foot danger" role="status">{message}</p>
      <p className="section-foot">App-Code vergessen? Dann bleib angemeldet und lege unter „App-Code ändern“ einen neuen fest.</p>
    </Sheet>
  )
}

function faceIdStatus(ring: Keyring | null, available: boolean) {
  if (!ring) return ''
  if (ring.faceId?.wrapped) return 'Der Schlüssel ist an Face ID gebunden'
  if (ring.faceId && ring.device) return 'Der Schlüssel liegt geschützt auf diesem iPhone'
  if (!available) return 'Auf diesem Gerät nicht verfügbar'
  if (isSignedIn(ring)) return 'Aus: Budget öffnet sich ohne Abfrage'
  return 'Abgemeldet: Budget fragt nach dem App-Code'
}

export function SecurityPage({ onBack }: { onBack: () => void }) {
  const { alert, toast } = useApp()
  const [ring, setRing] = useState<Keyring | null>(null)
  const [available, setAvailable] = useState(false)
  const [changing, setChanging] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const reload = useCallback(() => { getKeyring().then((value) => setRing(value ?? null)) }, [])
  useEffect(() => {
    reload()
    faceIdAvailable().then(setAvailable)
  }, [reload])

  const signedIn = !!ring && isSignedIn(ring)
  const faceIdOn = signedIn && !!ring?.faceId

  const toggleFaceId = async (on: boolean) => {
    if (!on) {
      alert({
        title: 'Face ID ausschalten?',
        message: 'Budget öffnet sich dann ohne Abfrage. Wer dein entsperrtes iPhone in der Hand hat, sieht deine Finanzen. Verschlüsselt gespeichert bleiben die Daten trotzdem.',
        buttons: [
          { label: 'Ausschalten', style: 'destructive', onClick: async () => { await signIn(null); toast('Face ID ist aus'); reload() } },
          { label: 'Abbrechen', style: 'strong' },
        ],
      })
      return
    }
    try {
      const { credentialId, salt, secret } = await registerFaceId()
      await signIn({ credentialId, prfSalt: salt, secret })
      toast('Face ID ist aktiv')
    } catch (error) {
      console.error(error)
      alert({
        title: 'Face ID nicht eingerichtet',
        message: 'Der Vorgang wurde abgebrochen oder dein iPhone hat ihn abgelehnt. Prüfe, ob Face ID und der iCloud-Schlüsselbund aktiv sind.',
        buttons: [{ label: 'OK', style: 'strong' }],
      })
    }
    reload()
  }

  return (
    <SubPage title="Face ID & Code" onBack={onBack}>
      <div className="group">
        <div className="row">
          <span className="row-main">
            Mit Face ID entsperren
            <span className="row-sub" style={{ display: 'block', whiteSpace: 'normal' }}>{faceIdStatus(ring, available)}</span>
          </span>
          <Switch label="Face ID" checked={faceIdOn} onChange={toggleFaceId} />
        </div>
        {/* Signed in without Face ID the app would open again right away */}
        {(faceIdOn || !signedIn) && (
          <label className="row">
            <span className="row-main">Sperren im Hintergrund</span>
            <select aria-label="Wann sperren" value={ring?.lockAfter === null || !ring ? 'never' : String(ring.lockAfter)}
              onChange={async (e) => { await setLockAfter(e.target.value === 'never' ? null : Number(e.target.value)); reload() }}>
              {LOCK_AFTER.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        )}
        <button className="row tint" onClick={() => setChanging(true)}>App-Code ändern</button>
      </div>
      <p className="section-foot">
        Klappt Face ID nicht, bietet dir dein iPhone den iPhone-Code an. Den App-Code brauchst du nur, wenn dieses iPhone abgemeldet ist, oder als Notfall auf dem Sperrbildschirm.
      </p>

      {signedIn && (
        <>
          <div className="group" style={{ marginTop: 20 }}>
            <button className="row center danger" onClick={() => setSigningOut(true)}>Dieses Gerät abmelden</button>
          </div>
          <p className="section-foot">Danach ist beim Öffnen wieder der App-Code nötig.</p>
        </>
      )}

      <h2 className="section-title">So sind deine Daten geschützt</h2>
      <div className="card prose">
        <p><b>Verschlüsselt:</b> Alle Einträge, Kategorien, Daueraufträge, Abos, Einstellungen und dein API-Schlüssel liegen mit AES-256 verschlüsselt auf diesem iPhone. Der App-Code öffnet den Schlüssel dafür immer. Der Code selbst wird nirgends gespeichert.</p>
        <p><b>Angemeldetes iPhone:</b> Damit du den App-Code nicht jedes Mal brauchst, liegt der Schlüssel zusätzlich auf diesem Gerät. Ist er an Face ID gebunden, gibt nur dein iPhone nach Face ID oder iPhone-Code das Geheimnis heraus, das ihn öffnet. Sonst liegt er als nicht exportierbarer Schlüssel im Speicher der App, und die App fragt vor dem Öffnen Face ID ab. Das schützt vor jemandem, der dein iPhone in die Hand nimmt, aber nicht vor jemandem, der den Speicher deines entsperrten iPhones technisch ausliest.</p>
        <p><b>Die Web-Adresse ist öffentlich,</b> deine Daten aber nicht. Wer die Adresse öffnet, bekommt eine leere App mit eigenem Speicher auf seinem eigenen Gerät. Zu deinem iPhone gibt es keine Verbindung.</p>
        <p><b>Neues iPhone oder gelöschte Website-Daten:</b> Deine Daten liegen nur auf diesem Gerät. Sind sie weg, hilft auch der App-Code nicht, sondern nur dein letztes Backup. Sichere deshalb regelmäßig ein Backup.</p>
        <p><b>Exportierte Backups</b> sind nicht verschlüsselt. Bewahre sie sicher auf, etwa in iCloud Drive.</p>
      </div>
      {changing && <ChangeCodeSheet onClose={() => setChanging(false)} />}
      {signingOut && <SignOutSheet onClose={() => setSigningOut(false)} />}
    </SubPage>
  )
}
