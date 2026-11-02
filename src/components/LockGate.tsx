import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { useMeta } from '../context'
import { checkPin, getLock, PIN_LENGTH, verifyFaceId, type LockConfig } from '../lib/lock'
import { takeSystemDialog } from '../lib/lockGuard'

const ICON = `${import.meta.env.BASE_URL}icons/apple-touch-icon.png`
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function PinDots({ length }: { length: number }) {
  return (
    <div className="pin-dots" aria-label={`${length} von ${PIN_LENGTH} Ziffern`}>
      {Array.from({ length: PIN_LENGTH }, (_, i) => <i key={i} className={i < length ? 'on' : undefined} />)}
    </div>
  )
}

export function PinPad({ onDigit, onBack, left }: { onDigit: (digit: string) => void; onBack: () => void; left?: ReactNode }) {
  return (
    <div className="pin-pad">
      {PAD.map((d) => <button key={d} onClick={() => onDigit(d)}>{d}</button>)}
      {left ?? <span />}
      <button onClick={() => onDigit('0')}>0</button>
      <button className="plain" aria-label="Löschen" onClick={onBack}><Icon name="backspace" size={28} width={1.6} /></button>
    </div>
  )
}

function LockScreen({ lock, onUnlock }: { lock: LockConfig; onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [failures, setFailures] = useState(0)
  const [waitUntil, setWaitUntil] = useState(0)
  const tried = useRef(false)

  const faceId = useCallback(async () => {
    if (!lock.credentialId) return
    try {
      await verifyFaceId(lock.credentialId)
      onUnlock()
    } catch {
      setMessage('Face ID hat nicht geklappt. Gib deine PIN ein.')
    }
  }, [lock.credentialId, onUnlock])

  useEffect(() => {
    if (tried.current) return
    tried.current = true
    faceId()
  }, [faceId])

  const press = async (digit: string) => {
    if (Date.now() < waitUntil) return
    const next = pin + digit
    setPin(next)
    if (next.length < PIN_LENGTH) return
    if (await checkPin(next, lock)) {
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
      <h1>Budget ist gesperrt</h1>
      <PinDots length={pin.length} />
      <p role="status">{message || 'PIN eingeben'}</p>
      <PinPad
        onDigit={press}
        onBack={() => setPin(pin.slice(0, -1))}
        left={lock.credentialId
          ? <button className="plain" aria-label="Mit Face ID entsperren" onClick={faceId}><Icon name="face" size={36} width={1.5} /></button>
          : undefined}
      />
    </div>
  )
}

/** Covers the app with the lock screen; content stays mounted so an open form survives. */
export function LockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'locked' | 'open'>('loading')
  const hiddenAt = useRef<number | null>(null)
  const systemDialog = useRef(false)
  const lock = useMeta<LockConfig | null>('lock', null)

  useEffect(() => {
    getLock().then((config) => setState(config ? 'locked' : 'open'))
  }, [])

  useEffect(() => {
    const onChange = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        systemDialog.current = takeSystemDialog()
      }
      const config = await getLock()
      if (!config || systemDialog.current) return
      if (document.visibilityState === 'hidden') {
        // Locks right away so the app switcher preview shows no numbers
        if (config.lockAfter === 0) setState('locked')
      } else if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= config.lockAfter * 1000) {
        setState('locked')
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  if (state === 'loading') return null
  return (
    <>
      {children}
      {state === 'locked' && lock && <LockScreen key={hiddenAt.current ?? 0} lock={lock} onUnlock={() => setState('open')} />}
    </>
  )
}
