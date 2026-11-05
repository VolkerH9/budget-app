import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownRight, ArrowUpRight, ChevronDown } from 'lucide-react'
import { addMonths, monthLabel, monthOf, today } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { change } from '../lib/stats'
import { Icon } from './Icon'

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([key, label]) => (
        <button key={key} aria-pressed={key === value} onClick={() => onChange(key)}>{label}</button>
      ))}
    </div>
  )
}

export function Sheet({ title, onClose, action, full, children }: {
  title: string
  onClose: () => void
  action?: { label: string; onClick: () => void; disabled?: boolean }
  full?: boolean
  children: ReactNode
}) {
  // Rendered at app level, otherwise it would scroll with the page behind the tab bar
  return createPortal(
    <div className="sheet-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-scrim" onClick={onClose} />
      <div className={full ? 'sheet full' : 'sheet'}>
        <div className="sheet-head">
          <button onClick={onClose}>Abbrechen</button>
          <h2>{title}</h2>
          {action ? <button onClick={action.onClick} disabled={action.disabled}>{action.label}</button> : <span />}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.querySelector('.app')!,
  )
}

export interface AlertButton {
  label: string
  style?: 'strong' | 'destructive'
  onClick?: () => void
}

export function Alert({ title, message, buttons, onClose }: { title: string; message?: string; buttons: AlertButton[]; onClose: () => void }) {
  return (
    <div className="alert-root" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="alert">
        <div className="alert-text">
          <h3>{title}</h3>
          {message && <p>{message}</p>}
        </div>
        {buttons.map((b) => (
          <button key={b.label} className={`alert-btn ${b.style ?? ''}`} onClick={() => { onClose(); b.onClick?.() }}>{b.label}</button>
        ))}
      </div>
    </div>
  )
}

export function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const start = useRef<number | null>(null)
  const current = monthOf(today())
  return (
    <div
      className="month-picker"
      onPointerDown={(e) => { start.current = e.clientX }}
      onPointerUp={(e) => {
        if (start.current === null) return
        const dx = e.clientX - start.current
        start.current = null
        if (Math.abs(dx) > 40) onChange(addMonths(month, dx < 0 ? 1 : -1))
      }}
    >
      <button className="icon-btn" aria-label="Vorheriger Monat" onClick={() => onChange(addMonths(month, -1))}><Icon name="left" size={22} /></button>
      <button className="month-label" onClick={() => onChange(current)}>
        {monthLabel(month)}
        {month !== current && <small>Zum aktuellen Monat</small>}
      </button>
      <button className="icon-btn" aria-label="Nächster Monat" onClick={() => onChange(addMonths(month, 1))}><Icon name="right" size={22} /></button>
    </div>
  )
}

/** Horizontal swipe across a page changes the month. Ignored for mostly vertical movement. */
export function useMonthSwipe(month: string, onChange: (month: string) => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      const target = e.target as HTMLElement
      start.current = target.closest('.recharts-responsive-container, .chips') ? null : { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return
      const t = e.changedTouches[0]
      const dx = t.clientX - start.current.x
      const dy = t.clientY - start.current.y
      start.current = null
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) onChange(addMonths(month, dx < 0 ? 1 : -1))
    },
  }
}

export function Toast({ text, onUndo, onDone }: { text: string; onUndo?: () => void; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 5000)
    return () => clearTimeout(timer)
  }, [text, onDone])
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      {onUndo && <button onClick={() => { onUndo(); onDone() }}>Rückgängig</button>}
    </div>
  )
}

export function YearPicker({ year, onChange }: { year: number; onChange: (year: number) => void }) {
  const current = Number(today().slice(0, 4))
  return (
    <div className="month-picker">
      <button className="icon-btn" aria-label="Vorheriges Jahr" onClick={() => onChange(year - 1)}><Icon name="left" size={22} /></button>
      <button className="month-label" onClick={() => onChange(current)}>
        {year}
        {year !== current && <small>Zum aktuellen Jahr</small>}
      </button>
      <button className="icon-btn" aria-label="Nächstes Jahr" onClick={() => onChange(year + 1)}><Icon name="right" size={22} /></button>
    </div>
  )
}

/** Remembers a choice while the app is open, also when the page is left and opened again. */
const sticky = new Map<string, unknown>()
export function useSticky<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (sticky.has(key) ? (sticky.get(key) as T) : initial))
  return [value, (next: T) => { sticky.set(key, next); setValue(next) }]
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Counts up to a new value, quickly and with a soft ending. */
export function useCountUp(value: number, duration = 650): number {
  const [shown, setShown] = useState(reducedMotion() ? value : 0)
  const from = useRef(0)
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const begin = from.current
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      const next = Math.round(begin + (value - begin) * eased)
      from.current = next
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return shown
}

export function CountUp({ cents, className }: { cents: number; className?: string }) {
  return <span className={className ? `num ${className}` : 'num'} aria-label={formatEuro(cents)}>{formatEuro(useCountUp(cents))}</span>
}

/** Content that glides open and closed. Closed content leaves the page after the slide. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), 280)
    return () => clearTimeout(timer)
  }, [open])
  return (
    <div className={open ? 'collapse open' : 'collapse'} aria-hidden={!open}>
      <div>{(open || mounted) && children}</div>
    </div>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return <ChevronDown className={open ? 'chev open' : 'chev'} size={18} strokeWidth={2} aria-hidden="true" />
}

/** Small arrow with the change in percent, e.g. "↗ 15 % zu Oktober" */
export function Trend({ current, previous, label }: { current: number; previous: number; label?: string }) {
  if (current === 0 && previous === 0) return null
  const ratio = change(current, previous)
  if (ratio === null) return <span className="trend">neu{label ? ` ${label}` : ''}</span>
  const percent = Math.round(Math.abs(ratio) * 100)
  if (percent === 0) return <span className="trend">± 0 %{label ? ` ${label}` : ''}</span>
  const Arrow = ratio > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className="trend" aria-label={`${ratio > 0 ? 'plus' : 'minus'} ${percent} Prozent${label ? ` ${label}` : ''}`}>
      <Arrow size={13} strokeWidth={2.2} aria-hidden="true" />
      {ratio > 0 ? '+' : '−'}{percent} %{label ? ` ${label}` : ''}
    </span>
  )
}
