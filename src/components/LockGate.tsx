import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { getMeta } from '../db'
import { backupName, markBackupDone, saveFile } from '../lib/backup'
import { checkFaceId, checkLegacyPin, faceIdAvailable, PIN_LENGTH, registerFaceId, verifyLegacyFaceId } from '../lib/lock'
import { takeSystemDialog } from '../lib/lockGuard'
import {
  getKeyring, isSignedIn, MIN_CODE_LENGTH, prepareSetup, resetDevice, setupVault, signIn, startState, unlockOnDevice, unlockWithCode,
  type Keyring, type LegacyLock,
} from '../lib/vault'
import { Icon } from './Icon'
import { Alert, type AlertButton } from './ui'

const ICON = `${import.meta.env.BASE_URL}icons/apple-touch-icon.png`
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

type Dialog = { title: string; message?: string; buttons: AlertButton[] } | null

function PinDots({ length }: { length: number }) {
  return (
    <div className="pin-dots" aria-label={`${length} von ${PIN_LENGTH} Ziffern`}>
      {Array.from({ length: PIN_LENGTH }, (_, i) => <i key={i} className={i < length ? 'on' : undefined} />)}
    </div>
  )
}

/** The PIN of the previous version, asked once before the new code replaces it. */
function LegacyLockScreen({ lock, onUnlock }: { lock: LegacyLock; onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [failures, setFailures] = useState(0)
  const [waitUntil, setWaitUntil] = useState(0)

  const faceId = async () => {
    if (!lock.credentialId) return
    try {
      await verifyLegacyFaceId(lock.credentialId)
      onUnlock()
    } catch {
      setMessage('Face ID hat nicht geklappt. Gib deine PIN ein.')
    }
  }

  const press = async (digit: string) => {
    if (Date.now() < waitUntil) return
    const next = pin + digit
    setPin(next)
    if (next.length < PIN_LENGTH) return
    if (await checkLegacyPin(next, lock)) {
      onUnlock()
      return
    }
    const count = failures + 1
    setFailures(count)
    setPin('')
    if (count % 5 === 0) {
      setWaitUntil(Date.now() + 30_000)
      setMessage('Zu viele Versuche. Warte 30 Sekunden.')
    } else {
      setMessage('Falsche PIN')
    }
  }

  return (
    <div className="lock" role="dialog" aria-label="App gesperrt">
      <img src={ICON} alt="" />
      <h1>Bisherige PIN</h1>
      <p>Entsperre ein letztes Mal mit deiner bisherigen PIN. Danach legst du deinen neuen App-Code fest.</p>
      <PinDots length={pin.length} />
      <p role="status">{message || 'PIN eingeben'}</p>
      <div className="pin-pad">
        {PAD.map((d) => <button key={d} onClick={() => press(d)}>{d}</button>)}
        {lock.credentialId
          ? <button className="plain" aria-label="Mit Face ID entsperren" onClick={faceId}><Icon name="face" size={36} width={1.5} /></button>
          : <span />}
        <button onClick={() => press('0')}>0</button>
        <button className="plain" aria-label="Löschen" onClick={() => setPin(pin.slice(0, -1))}><Icon name="backspace" size={28} width={1.6} /></button>
      </div>
    </div>
  )
}

/** Two fields for a new code. Reports the code once both match and it is long enough. */
export function CodeFields({ onChange, autoFocus }: { onChange: (code: string | null) => void; autoFocus?: boolean }) {
  const [code, setCode] = useState('')
  const [repeat, setRepeat] = useState('')
  const [show, setShow] = useState(false)
  useEffect(() => {
    onChange(code.length >= MIN_CODE_LENGTH && code === repeat ? code : null)
  }, [code, repeat, onChange])

  let hint = `Mindestens ${MIN_CODE_LENGTH} Zeichen. Buchstaben, Zahlen und Zeichen sind erlaubt.`
  if (code.length > 0 && code.length < MIN_CODE_LENGTH) hint = `Noch ${MIN_CODE_LENGTH - code.length} Zeichen`
  else if (repeat.length > 0 && code !== repeat) hint = 'Die beiden Eingaben sind verschieden.'
  else if (code.length >= MIN_CODE_LENGTH && /^\d+$/.test(code) && code.length < 10) hint = 'Tipp: Mit Buchstaben und mehr Zeichen wird der Code deutlich sicherer.'
  else if (code.length >= MIN_CODE_LENGTH && code === repeat) hint = '✓ Die Eingaben stimmen überein.'

  return (
    <>
      <div className="group">
        <input type="text" name="username" autoComplete="username" value="Budget-App" readOnly hidden />
        <label className="row">
          <input className="left" type={show ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder="Neuer App-Code" aria-label="Neuer App-Code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus={autoFocus} />
        </label>
        <label className="row">
          <input className="left" type={show ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder="Code wiederholen" aria-label="Code wiederholen" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
        <button type="button" className="row tint" onClick={() => setShow(!show)}>{show ? 'Code verbergen' : 'Code anzeigen'}</button>
      </div>
      <p className="section-foot" role="status">{hint}</p>
    </>
  )
}

function SetupScreen({ onDone }: { onDone: (checked: number) => void }) {
  const [info, setInfo] = useState<{ entries: number; recurring: number; legacy: boolean } | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const prepared = useRef(false)
  const onCode = useCallback((value: string | null) => setCode(value), [])

  useEffect(() => {
    if (prepared.current) return
    prepared.current = true
    prepareSetup().then(setInfo).catch((error) => setDialog({ title: 'Fehler beim Laden', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] }))
  }, [])

  const exportBackup = async () => {
    try {
      const backup = await getMeta('preUpdateBackup', null)
      await saveFile(backupName('json'), JSON.stringify(backup), 'application/json')
      await markBackupDone()
      setSaved(true)
    } catch (error) {
      setDialog({ title: 'Backup nicht gesichert', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })
    }
  }

  const start = async () => {
    if (!code || !understood) return
    setBusy(true)
    try {
      const { checked } = await setupVault(code)
      onDone(checked)
    } catch (error) {
      setBusy(false)
      setDialog({ title: 'Das hat nicht geklappt', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })
    }
  }

  return (
    <div className="gate" role="dialog" aria-label="App-Code festlegen">
      <div className="gate-body">
        <img src={ICON} alt="" className="gate-icon" />
        <h1 className="gate-title">App-Code festlegen</h1>
        <p className="gate-lead">
          Budget schützt deine Daten mit einem persönlichen App-Code. Sie werden damit verschlüsselt auf diesem iPhone gespeichert. Im Alltag öffnest du die App danach mit Face ID, den App-Code brauchst du nur im Notfall.
        </p>

        {info?.legacy && (
          <div className="card gate-card">
            <b>Deine bisherigen Daten</b>
            <p>{info.entries} {info.entries === 1 ? 'Eintrag' : 'Einträge'} und {info.recurring} {info.recurring === 1 ? 'Dauerauftrag' : 'Daueraufträge'} werden verschlüsselt übernommen. Sichere vorher ein Backup.</p>
            <button className="secondary-btn" onClick={exportBackup}>{saved ? '✓ Backup gesichert' : 'Backup jetzt sichern'}</button>
          </div>
        )}

        <div className="card gate-card warn-card">
          <b>Wichtig: Code sicher aufbewahren</b>
          <p>Vergisst du den Code, kann niemand deine Daten wiederherstellen, auch nicht mit Hilfe von außen. Dann bleibt nur, die App zurückzusetzen und dein letztes Backup einzuspielen. Notiere den Code zum Beispiel in der Passwörter-App.</p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); start() }}>
          <CodeFields onChange={onCode} />
          <label className="check-row">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>Ich habe verstanden, dass ein vergessener Code nicht zurückgesetzt werden kann.</span>
          </label>
          <button className="primary-btn" type="submit" disabled={!info || !code || !understood || busy}>
            {busy ? 'Wird verschlüsselt …' : 'Verschlüsseln und starten'}
          </button>
        </form>
      </div>
      {dialog && <Alert {...dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

const countdown = (ms: number) => {
  const seconds = Math.ceil(ms / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} Min.` : `${seconds} Sek.`
}

/** Shown once the code opened a device that is not signed in: from now on Face ID opens the app. */
function SignInScreen({ onDone }: { onDone: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { faceIdAvailable().then(setAvailable) }, [])

  const withFaceId = async () => {
    setBusy(true)
    setMessage('')
    try {
      const { credentialId, salt, secret } = await registerFaceId()
      await signIn({ credentialId, prfSalt: salt, secret })
      onDone()
    } catch (error) {
      console.error(error)
      setBusy(false)
      setMessage('Face ID wurde nicht eingerichtet. Versuche es noch einmal oder richte es später in den Einstellungen ein.')
    }
  }

  const withoutFaceId = async () => {
    await signIn(null)
    onDone()
  }

  return (
    <div className="gate" role="dialog" aria-label="Face ID einrichten">
      <div className="gate-body">
        <img src={ICON} alt="" className="gate-icon" />
        <h1 className="gate-title">Mit Face ID öffnen</h1>
        <p className="gate-lead">
          Ab jetzt öffnest du Budget mit Face ID. Klappt Face ID nicht, bietet dir dein iPhone den iPhone-Code an. Den App-Code brauchst du nur noch, wenn dieses iPhone abgemeldet ist.
        </p>
        <div className="card gate-card warn-card">
          <b>App-Code trotzdem aufheben</b>
          <p>Weil du ihn nur selten brauchst, vergisst man ihn leicht. Notiere ihn zum Beispiel in der Passwörter-App.</p>
        </div>
        {available === false ? (
          <>
            <div className="card gate-card">
              <p>Face ID ist auf diesem Gerät nicht verfügbar. Bleibt das Gerät angemeldet, öffnet sich Budget ohne Abfrage.</p>
            </div>
            <button className="primary-btn" onClick={withoutFaceId}>Angemeldet bleiben</button>
          </>
        ) : (
          <button className="primary-btn face-btn" disabled={busy || available === null} onClick={withFaceId}>
            <Icon name="face" size={24} width={1.6} /> {busy ? 'Wird eingerichtet …' : 'Face ID einrichten'}
          </button>
        )}
        <p className="gate-status" role="status">{message}</p>
        <button className="link-btn gate-skip" onClick={onDone}>Nicht jetzt</button>
      </div>
    </div>
  )
}

function LockScreen({ onUnlock }: { onUnlock: (signInNext: boolean) => void }) {
  const [ring, setRing] = useState<Keyring | null>(null)
  const [withCode, setWithCode] = useState(false)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [blockedUntil, setBlockedUntil] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const tried = useRef(false)
  const now = Math.max(useNow(blockedUntil > Date.now()), Date.now())
  const blocked = blockedUntil > now
  const faceId = ring?.faceId && isSignedIn(ring) ? ring.faceId : null

  useEffect(() => {
    getKeyring().then((value) => {
      if (!value) return
      setRing(value)
      setBlockedUntil(value.blockedUntil)
    })
  }, [])

  const unlockFace = useCallback(async (auto: boolean) => {
    if (!faceId) return
    setBusy(true)
    setMessage('')
    try {
      const secret = await checkFaceId(faceId.credentialId, faceId.prfSalt as Uint8Array<ArrayBuffer> | undefined)
      if (faceId.wrapped && !secret) {
        setBusy(false)
        setWithCode(true)
        setMessage('Face ID konnte die App diesmal nicht entsperren. Gib deinen App-Code ein.')
        return
      }
      await unlockOnDevice(secret)
      onUnlock(false)
    } catch {
      setBusy(false)
      // Without a tap iOS may refuse the automatic request; the button is right there
      if (!auto) setMessage('Face ID hat nicht geklappt. Versuche es noch einmal oder nimm deinen App-Code.')
    }
  }, [faceId, onUnlock])

  // Face ID starts by itself as soon as the app is in front
  useEffect(() => {
    if (!faceId) return
    const attempt = () => {
      if (tried.current || document.visibilityState !== 'visible') return
      tried.current = true
      unlockFace(true)
    }
    attempt()
    document.addEventListener('visibilitychange', attempt)
    return () => document.removeEventListener('visibilitychange', attempt)
  }, [faceId, unlockFace])

  const submit = async () => {
    if (!code || busy || blocked || !ring) return
    setBusy(true)
    const result = await unlockWithCode(code)
    if (result.ok) {
      onUnlock(!isSignedIn(ring))
      return
    }
    setBusy(false)
    setCode('')
    setBlockedUntil(result.blockedUntil)
    setMessage(result.blockedUntil > Date.now() ? 'Falscher Code. Zu viele Versuche.' : 'Falscher Code')
  }

  const forgot = () => setDialog({
    title: 'App-Code vergessen?',
    message: faceId
      ? 'Entsperre mit Face ID und lege in den Einstellungen unter „Face ID & Code“ einen neuen App-Code fest. Dafür brauchst du den alten nicht.'
      : 'Der App-Code lässt sich nicht zurücksetzen und von niemandem wiederherstellen. Genau das schützt deine Daten. Du kannst die App zurücksetzen: Dabei werden alle Daten auf diesem iPhone gelöscht. Danach legst du einen neuen App-Code fest und spielst in den Einstellungen dein letztes Backup ein.',
    buttons: [
      {
        label: 'App zurücksetzen …',
        style: 'destructive',
        onClick: () => setDialog({
          title: 'Wirklich alles löschen?',
          message: 'Alle Einträge, Kategorien, Daueraufträge, Abos und Einstellungen auf diesem iPhone werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.',
          buttons: [
            { label: 'Alles löschen', style: 'destructive', onClick: () => resetDevice().then(() => location.reload()) },
            { label: 'Abbrechen', style: 'strong' },
          ],
        }),
      },
      { label: 'Abbrechen', style: 'strong' },
    ],
  })

  if (!ring) return <div className="lock" />

  if (faceId && !withCode) {
    return (
      <div className="lock" role="dialog" aria-label="App gesperrt">
        <img src={ICON} alt="" />
        <h1>Budget ist gesperrt</h1>
        <button className="primary-btn face-btn" disabled={busy} onClick={() => unlockFace(false)}>
          <Icon name="face" size={24} width={1.6} /> Mit Face ID entsperren
        </button>
        <p role="status">{message || 'Klappt Face ID nicht, bietet dir dein iPhone den iPhone-Code an.'}</p>
        <button className="link-btn" onClick={() => { setMessage(''); setWithCode(true) }}>Mit App-Code entsperren</button>
      </div>
    )
  }

  return (
    <div className="lock" role="dialog" aria-label="App gesperrt">
      <img src={ICON} alt="" />
      <h1>Budget ist gesperrt</h1>
      <form className="code-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input type="text" name="username" autoComplete="username" value="Budget-App" readOnly hidden />
        <input className="code-input" type="password" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="App-Code" aria-label="App-Code" value={code} disabled={blocked} onChange={(e) => setCode(e.target.value)} />
        <button className="primary-btn" type="submit" disabled={!code || busy || blocked}>{busy ? 'Wird geprüft …' : 'Entsperren'}</button>
      </form>
      {faceId && (
        <button className="secondary-btn face-btn" disabled={busy} onClick={() => { setWithCode(false); unlockFace(false) }}>
          <Icon name="face" size={24} width={1.6} /> Mit Face ID entsperren
        </button>
      )}
      <p role="status">{blocked ? `${message ? `${message} ` : ''}Nächster Versuch in ${countdown(blockedUntil - now)}` : message}</p>
      <button className="link-btn" onClick={forgot}>App-Code vergessen?</button>
      {dialog && <Alert {...dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}

type Phase = 'loading' | 'legacy' | 'setup' | 'signin' | 'locked' | 'open'

/** A signed-in device without Face ID opens right away, so a lock would only flash by. */
const opensWithoutCheck = (ring: Keyring) => isSignedIn(ring) && !ring.faceId

/**
 * Nothing of the data is in the app before the code, Face ID or the signed-in device unlocked it.
 * After a later lock the content stays mounted, so an open form survives.
 */
export function LockGate({ children, onSetupDone }: { children: ReactNode; onSetupDone: (checked: number) => void }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [legacyLock, setLegacyLock] = useState<LegacyLock | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [covered, setCovered] = useState(false)
  const [fault, setFault] = useState('')
  const [setupChecked, setSetupChecked] = useState<number | null>(null)
  const hiddenAt = useRef<number | null>(null)
  const systemDialog = useRef(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const open = useCallback(() => {
    setLoaded(true)
    setPhase('open')
  }, [])

  useEffect(() => {
    startState().then(async (state) => {
      if (state.kind === 'locked') {
        if (opensWithoutCheck(state.keyring)) {
          try {
            await unlockOnDevice(null)
            open()
            return
          } catch {
            // The device key no longer fits: the code still opens the data
          }
        }
        setPhase('locked')
      } else if (state.kind === 'legacy' && state.lock) {
        setLegacyLock(state.lock)
        setPhase('legacy')
      } else setPhase('setup')
    }).catch((error) => setFault((error as Error).message))
  }, [open])

  useEffect(() => {
    const onChange = async () => {
      if (phaseRef.current !== 'open' && phaseRef.current !== 'locked') return
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        systemDialog.current = takeSystemDialog()
        // Hides the numbers in the app switcher preview
        if (!systemDialog.current) setCovered(true)
      } else {
        setCovered(false)
      }
      const ring = await getKeyring()
      if (!ring || ring.lockAfter === null || opensWithoutCheck(ring) || systemDialog.current || phaseRef.current !== 'open') return
      if (document.visibilityState === 'hidden') {
        if (ring.lockAfter === 0) setPhase('locked')
      } else if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= ring.lockAfter * 1000) {
        setPhase('locked')
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const unlocked = useCallback((signInNext: boolean) => {
    // Asked only when the app starts, not after every lock
    if (signInNext && !loaded) setPhase('signin')
    else open()
  }, [loaded, open])

  const signedIn = useCallback(() => {
    open()
    if (setupChecked !== null) onSetupDone(setupChecked)
    setSetupChecked(null)
  }, [open, onSetupDone, setupChecked])

  if (fault) {
    return (
      <div className="lock">
        <h1>Budget konnte nicht starten</h1>
        <p>{fault}</p>
        <button className="primary-btn" onClick={() => location.reload()}>Neu laden</button>
      </div>
    )
  }
  if (phase === 'loading') return null
  if (phase === 'legacy' && legacyLock) return <LegacyLockScreen lock={legacyLock} onUnlock={() => setPhase('setup')} />
  if (phase === 'setup') return <SetupScreen onDone={(checked) => { setSetupChecked(checked); setPhase('signin') }} />
  if (phase === 'signin') return <SignInScreen onDone={signedIn} />
  return (
    <>
      {loaded && children}
      {phase === 'locked' && <LockScreen key={hiddenAt.current ?? 0} onUnlock={unlocked} />}
      {covered && phase === 'open' && <div className="privacy-cover"><img src={ICON} alt="" /></div>}
    </>
  )
}
