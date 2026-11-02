import { displayInput, pressKey } from '../lib/format'
import { Icon } from './Icon'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back']

export function AmountDisplay({ text }: { text: string }) {
  return (
    <div className={text === '' ? 'amount-display placeholder num' : 'amount-display num'} aria-live="polite">
      <span>{displayInput(text)}</span>
      <span className="cur">€</span>
    </div>
  )
}

export function Keypad({ onChange }: { onChange: (update: (value: string) => string) => void }) {
  return (
    <div className="keypad">
      {KEYS.map((key) => (
        <button key={key} className="key" aria-label={key === 'back' ? 'Löschen' : key} onClick={() => onChange((value) => pressKey(value, key))}>
          {key === 'back' ? <Icon name="backspace" size={26} width={1.6} /> : key}
        </button>
      ))}
    </div>
  )
}
