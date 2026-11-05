import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { getMeta } from '../db'
import { backupName, markBackupDone, saveFile } from '../lib/backup'
import { checkLegacyPin, NoPrfError, PIN_LENGTH, readFaceIdSecret, verifyLegacyFaceId } from '../lib/lock'
import { takeSystemDialog } from '../lib/lockGuard'
import {
  getKeyring, MIN_CODE_LENGTH, prepareSetup, resetDevice, setupVault, startState, unlockWithCode, unlockWithFaceId,
  type LegacyLock,
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
      <p>Entsperre ein letztes Mal mit deiner bisherigen PIN. Danach legst du deinen neuen Zugangscode fest.</p>
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
            placeholder="Neuer Zugangscode" aria-label="Neuer Zugangscode" value={code} onChange={(e) => setCode(e.target.value)} autoFocus={autoFocus} />
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
    <div className="gate" role="dialog" aria-label="Zugangscode festlegen">
      <div className="gate-body">
        <img src={ICON} alt="" className="gate-icon" />
        <h1 className="gate-title">Zugangscode festlegen</h1>
        <p className="gate-lead">
          Budget schützt deine Daten jetzt mit einem persönlichen Code. Sie werden damit verschlüsselt auf diesem iPhone gespeichert. Ohne den Code öffnet sich die App nicht.
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

function LockScreen({ onUnlock, tryFaceId }: { onUnlock: () => void; tryFaceId: boolean }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [blockedUntil, setBlockedUntil] = useState(0)
  const [faceId, setFaceId] = useState<{ credentialId: string; prfSalt: Uint8Array<ArrayBuffer> } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const tried = useRef(false)
  const now = Math.max(useNow(blockedUntil > Date.now()), Date.now())
  const blocked = blockedUntil > now

  const unlockFace = useCallback(async (ring: { credentialId: string; prfSalt: Uint8Array<ArrayBuffer> }) => {
    try {
      setBusy(true)
      await unlockWithFaceId(await readFaceIdSecret(ring.credentialId, ring.prfSalt))
      onUnlock()
    } catch (error) {
      setBusy(false)
      setMessage(error instanceof NoPrfError ? 'Face ID konnte die App nicht entsperren. Gib deinen Code ein.' : 'Face ID hat nicht geklappt. Gib deinen Code ein.')
    }
  }, [onUnlock])

  useEffect(() => {
    getKeyring().then((ring) => {
      if (!ring) return
      setBlockedUntil(ring.blockedUntil)
      const face = ring.faceId ? { credentialId: ring.faceId.credentialId, prfSalt: ring.faceId.prfSalt as Uint8Array<ArrayBuffer> } : null
      setFaceId(face)
      if (face && tryFaceId && !tried.current && ring.blockedUntil < Date.now()) {
        tried.current = true
        unlockFace(face)
      }
    })
  }, [tryFaceId, unlockFace])

  const submit = async () => {
    if (!code || busy || blocked) return
    setBusy(true)
    const result = await unlockWithCode(code)
    if (result.ok) {
      onUnlock()
      return
    }
    setBusy(false)
    setCode('')
    setBlockedUntil(result.blockedUntil)
    setMessage(result.blockedUntil > Date.now() ? 'Falscher Code. Zu viele Versuche.' : 'Falscher Code')
  }

  const forgot = () => setDialog({
    title: 'Code vergessen?',
    message: 'Der Code lässt sich nicht zurücksetzen und von niemandem wiederherstellen. Genau das schützt deine Daten. Du kannst die App zurücksetzen: Dabei werden alle Daten auf diesem iPhone gelöscht. Danach legst du einen neuen Code fest und spielst in den Einstellungen dein letztes Backup ein.',
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

  return (
    <div className="lock" role="dialog" aria-label="App gesperrt">
      <img src={ICON} alt="" />
      <h1>Budget ist gesperrt</h1>
      <form className="code-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input type="text" name="username" autoComplete="username" value="Budget-App" readOnly hidden />
        <input className="code-input" type="password" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="Zugangscode" aria-label="Zugangscode" value={code} disabled={blocked} onChange={(e) => setCode(e.target.value)} />
        <button className="primary-btn" type="submit" disabled={!code || busy || blocked}>{busy ? 'Wird geprüft …' : 'Entsperren'}</button>
      </form>
      {faceId && (
        <button className="secondary-btn face-btn" disabled={busy || blocked} onClick={() => unlockFace(faceId)}>
          <Icon name="face" size={24} width={1.6} /> Mit Face ID entsperren
        </button>
      )}
      <p role="status">{blocked ? `${message ? `${message} ` : ''}Nächster Versuch in ${countdown(blockedUntil - now)}` : message}</p>
      <button className="link-btn" onClick={forgot}>Code vergessen?</button>
      {dialog && <Alert {...dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}

type Phase = 'loading' | 'legacy' | 'setup' | 'locked' | 'open'

/**
 * Nothing of the data is in the app before the code or Face ID unlocked it.
 * After a later lock the content stays mounted, so an open form survives.
 */
export function LockGate({ children, onSetupDone }: { children: ReactNode; onSetupDone: (checked: number) => void }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [legacyLock, setLegacyLock] = useState<LegacyLock | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [covered, setCovered] = useState(false)
  const [fault, setFault] = useState('')
  const hiddenAt = useRef<number | null>(null)
  const systemDialog = useRef(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    startState().then((state) => {
      if (state.kind === 'locked') setPhase('locked')
      else if (state.kind === 'legacy' && state.lock) {
        setLegacyLock(state.lock)
        setPhase('legacy')
      } else setPhase('setup')
    }).catch((error) => setFault((error as Error).message))
  }, [])

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
      if (!ring || systemDialog.current || phaseRef.current !== 'open') return
      if (document.visibilityState === 'hidden') {
        if (ring.lockAfter === 0) setPhase('locked')
      } else if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= ring.lockAfter * 1000) {
        setPhase('locked')
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const open = useCallback(() => {
    setLoaded(true)
    setPhase('open')
  }, [])

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
  if (phase === 'setup') return <SetupScreen onDone={(checked) => { open(); onSetupDone(checked) }} />
  return (
    <>
      {loaded && children}
      {phase === 'locked' && <LockScreen key={hiddenAt.current ?? 0} onUnlock={open} tryFaceId={!loaded || document.visibilityState === 'visible'} />}
      {covered && phase === 'open' && <div className="privacy-cover"><img src={ICON} alt="" /></div>}
    </>
  )
}
