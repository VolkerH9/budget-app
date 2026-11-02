import { useEffect, useState } from 'react'
import { useApp, useMeta } from '../context'
import { PinDots, PinPad } from '../components/LockGate'
import { Sheet, Switch } from '../components/ui'
import { checkPin, disableLock, enableLock, faceIdAvailable, PIN_LENGTH, registerFaceId, updateLock, type LockConfig } from '../lib/lock'
import { SubPage } from './Settings'

const LOCK_AFTER: [number, string][] = [[0, 'Bei jedem Öffnen'], [60, 'Nach 1 Minute'], [300, 'Nach 5 Minuten']]

/** Asks for a PIN once, or twice when `confirm` is set. */
function PinSheet({ title, confirm, verify, onDone, onClose }: {
  title: string
  confirm?: boolean
  verify?: (pin: string) => Promise<boolean>
  onDone: (pin: string) => void
  onClose: () => void
}) {
  const [pin, setPin] = useState('')
  const [first, setFirst] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const press = async (digit: string) => {
    const next = pin + digit
    setPin(next)
    if (next.length < PIN_LENGTH) return
    if (verify && !(await verify(next))) {
      setPin('')
      setMessage('Falsche PIN')
    } else if (confirm && first === null) {
      setFirst(next)
      setPin('')
      setMessage('')
    } else if (confirm && first !== next) {
      setFirst(null)
      setPin('')
      setMessage('Die PINs waren verschieden. Bitte noch einmal.')
    } else {
      onDone(next)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 16, padding: '8px 0' }}>
        <p className="row-sub" style={{ margin: 0 }} role="status">
          {message || (confirm ? (first === null ? `Wähle eine ${PIN_LENGTH}-stellige PIN` : 'PIN wiederholen') : 'PIN eingeben')}
        </p>
        <PinDots length={pin.length} />
        <PinPad onDigit={press} onBack={() => setPin(pin.slice(0, -1))} />
      </div>
    </Sheet>
  )
}

export function SecurityPage({ onBack }: { onBack: () => void }) {
  const { alert, toast } = useApp()
  const lock = useMeta<LockConfig | null>('lock', null)
  const [sheet, setSheet] = useState<'enable' | 'disable' | null>(null)
  const [available, setAvailable] = useState(false)

  useEffect(() => { faceIdAvailable().then(setAvailable) }, [])

  const toggleFaceId = async (on: boolean) => {
    if (!on) {
      await updateLock({ credentialId: undefined })
      return
    }
    try {
      await updateLock({ credentialId: await registerFaceId() })
      toast('Face ID ist aktiv')
    } catch {
      alert({
        title: 'Face ID nicht eingerichtet',
        message: 'Der Vorgang wurde abgebrochen oder dein iPhone hat ihn abgelehnt. Prüfe, ob Face ID und der iCloud-Schlüsselbund aktiv sind. Die PIN funktioniert weiterhin.',
        buttons: [{ label: 'OK', style: 'strong' }],
      })
    }
  }

  return (
    <SubPage title="Face ID und PIN" onBack={onBack}>
      <div className="group">
        <div className="row">
          <span className="row-main">App-Sperre</span>
          <Switch label="App-Sperre" checked={!!lock} onChange={(on) => setSheet(on ? 'enable' : 'disable')} />
        </div>
        {lock && (
          <div className="row">
            <span className="row-main">
              Face ID
              {!available && <span className="row-sub" style={{ display: 'block' }}>Auf diesem Gerät nicht verfügbar</span>}
            </span>
            <Switch label="Face ID" checked={!!lock.credentialId} onChange={toggleFaceId} />
          </div>
        )}
        {lock && (
          <label className="row">
            <span className="row-main">Sperren</span>
            <select aria-label="Wann sperren" value={lock.lockAfter} onChange={(e) => updateLock({ lockAfter: Number(e.target.value) })}>
              {LOCK_AFTER.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        )}
      </div>
      {lock && <p className="section-foot">Klappt Face ID nicht, entsperrst du die App mit deiner PIN. Eine vergessene PIN lässt sich nicht zurücksetzen. Dann hilft nur, die App neu zu installieren und ein Backup einzuspielen.</p>}

      <h2 className="section-title">Was die Sperre schützt</h2>
      <div className="card" style={{ fontSize: 15, lineHeight: 1.4 }}>
        <p style={{ marginTop: 0 }}><b>Sie schützt</b> vor neugierigen Blicken, wenn jemand dein entsperrtes iPhone in der Hand hat oder die App zufällig öffnet.</p>
        <p style={{ marginBottom: 0 }}><b>Sie schützt nicht</b> vor gezielten Angriffen. Deine Daten und dein API-Schlüssel liegen unverschlüsselt im Browser-Speicher der App. Wer dein iPhone entsperren und technisch darauf zugreifen kann, kommt an sie heran. Der wichtigste Schutz bleibt der Code deines iPhones.</p>
      </div>

      {sheet === 'enable' && (
        <PinSheet title="PIN festlegen" confirm onClose={() => setSheet(null)} onDone={async (pin) => {
          await enableLock(pin)
          setSheet(null)
          toast('App-Sperre ist aktiv')
        }} />
      )}
      {sheet === 'disable' && lock && (
        <PinSheet title="Sperre ausschalten" verify={(pin) => checkPin(pin, lock)} onClose={() => setSheet(null)} onDone={async () => {
          await disableLock()
          setSheet(null)
          toast('App-Sperre ist aus')
        }} />
      )}
    </SubPage>
  )
}
