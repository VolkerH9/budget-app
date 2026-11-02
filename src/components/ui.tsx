import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { addMonths, monthLabel, monthOf, today } from '../lib/dates'
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

export function CategoryIcon({ emoji, color }: { emoji: string; color: string }) {
  return <span className="emoji" style={{ background: `${color}2e` }} aria-hidden="true">{emoji}</span>
}
