import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Share, X } from 'lucide-react'
import { db, type Entry, type Goal } from '../db'
import { useApp, useAskToShare, useCategories, useGroups, useLabels } from '../context'
import { saveFiles } from '../lib/backup'
import { today } from '../lib/dates'
import { formatEuro } from '../lib/format'
import { buildWrapped, type WrappedCard } from '../lib/wrapped'
import type { StatementPeriod } from '../lib/statement'
import { CountUp } from './ui'

const DURATION = 6500

/** The text a card shows, with or without amounts */
export function cardText(card: WrappedCard, hide: boolean) {
  const big = hide ? (card.bigPrivate ?? card.big ?? '') : (card.big ?? '')
  const title = hide && card.titlePrivate !== undefined ? card.titlePrivate : card.title ?? ''
  const lines = card.lines.map((l) => (hide && l.private !== undefined ? l.private : l.text)).filter((l) => l !== '')
  return { big, title, lines }
}

/** The card as a 1080 × 1920 picture for the share sheet */
async function cardImage(card: WrappedCard, hide: boolean, period: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1920
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1920)
  gradient.addColorStop(0, card.colors[0])
  gradient.addColorStop(1, card.colors[1])
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1080, 1920)
  const font = '-apple-system, "SF Pro Display", Helvetica, Arial, sans-serif'
  const { big, title, lines } = cardText(card, hide)
  const value = card.cents !== undefined && !hide ? formatEuro(card.cents) : big
  const wrap = (text: string, size: number, weight: string, y: number, max = 920, gap = 1.2) => {
    ctx.font = `${weight} ${size}px ${font}`
    const words = text.split(' ')
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > max && line) {
        ctx.fillText(line, 80, y)
        y += size * gap
        line = word
      } else line = next
    }
    if (line) { ctx.fillText(line, 80, y); y += size * gap }
    return y
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  let y = wrap(card.eyebrow.toUpperCase(), 44, '600', 420)
  ctx.fillStyle = '#ffffff'
  let size = 150
  ctx.font = `800 ${size}px ${font}`
  while (ctx.measureText(value).width > 920 && size > 70) { size -= 8; ctx.font = `800 ${size}px ${font}` }
  y = wrap(value, size, '800', y + 160, 920, 1.1)
  if (title) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; y = wrap(title, 56, '600', y + 20) }
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  y += 50
  for (const l of lines) y = wrap(l, 44, '400', y + 20)
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = `500 36px ${font}`
  ctx.fillText(`Budget · ${period}`, 80, 1820)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
}

/** Full-screen review like stories: tap to go on, hold to pause */
export function WrappedPlayer({ period, title, onClose }: { period: StatementPeriod; title: string; onClose: () => void }) {
  const { alert } = useApp()
  const askToShare = useAskToShare()
  const categories = useCategories()
  const groups = useGroups()
  const labels = useLabels()
  const entries = useLiveQuery(() => db.entries.toArray(), [], undefined as Entry[] | undefined)
  const goals = useLiveQuery(() => db.goals.toArray(), [], [] as Goal[])
  const cards = useMemo(() => (entries ? buildWrapped(period, { entries, categories, groups, labels, goals, now: today(), euro: formatEuro }) : []), [period, entries, categories, groups, labels, goals])
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [hide, setHide] = useState(false)
  const press = useRef<{ at: number; x: number } | null>(null)

  // Runs the progress of the current card; `elapsed` is read once when it starts, so a pause resumes where it stopped
  useEffect(() => {
    if (paused || cards.length === 0) return
    const started = performance.now() - elapsed
    let frame = 0
    const tick = (now: number) => {
      const done = now - started
      if (done >= DURATION) {
        setElapsed(0)
        setIndex((i) => (i < cards.length - 1 ? i + 1 : i))
        if (index >= cards.length - 1) setPaused(true)
        return
      }
      setElapsed(done)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [paused, index, cards.length])

  useEffect(() => {
    if (!entries) return
    db.meta.get('wrappedSeen').then((row) => {
      const seen = (row?.value as string[] | undefined) ?? []
      if (!seen.includes(period.key)) db.meta.put({ key: 'wrappedSeen', value: [...seen, period.key].slice(-60) })
    })
  }, [entries, period.key])

  const go = (step: number) => {
    setElapsed(0)
    setPaused(false)
    setIndex((i) => Math.max(0, Math.min(cards.length - 1, i + step)))
  }

  const share = async () => {
    const card = cards[index]
    setPaused(true)
    try {
      const blob = await cardImage(card, hide, title)
      await saveFiles([new File([blob], `Rueckblick-${period.key}-${index + 1}.png`, { type: 'image/png' })], askToShare)
    } catch (error) {
      console.error(error)
      alert({ title: 'Teilen nicht möglich', message: 'Bitte versuche es noch einmal.', buttons: [{ label: 'OK', style: 'strong' }] })
    }
  }

  const card = cards[index]
  const content = (
    <div className="wrapped" role="dialog" aria-modal="true" aria-label={`Rückblick ${title}`} style={card ? { background: `linear-gradient(160deg, ${card.colors[0]}, ${card.colors[1]})` } : undefined}>
      <div className="wrapped-bars" aria-hidden="true">
        {cards.map((c, i) => (
          <span key={c.key}><i style={{ width: i < index ? '100%' : i === index ? `${(elapsed / DURATION) * 100}%` : '0%' }} /></span>
        ))}
      </div>
      <div className="wrapped-head">
        <span>Rückblick {title}</span>
        <button className="wrapped-icon" aria-label="Schließen" onClick={onClose}><X size={24} /></button>
      </div>
      {!entries ? null : cards.length === 0
        ? <div className="wrapped-card"><p className="wrapped-eyebrow">Rückblick {title}</p><p className="wrapped-title">Für diesen Zeitraum gibt es noch zu wenige Buchungen.</p></div>
        : (
          <div
            className="wrapped-stage"
            onPointerDown={(e) => { press.current = { at: Date.now(), x: e.clientX }; setPaused(true) }}
            onPointerUp={(e) => {
              const p = press.current
              press.current = null
              if (!p) return
              if (Date.now() - p.at < 250) {
                const box = e.currentTarget.getBoundingClientRect()
                go(e.clientX - box.left < box.width / 3 ? -1 : 1)
              } else setPaused(false)
            }}
            onPointerCancel={() => { press.current = null; setPaused(false) }}
          >
            {card && (() => {
              const { big, title: line, lines } = cardText(card, hide)
              return (
                <div className="wrapped-card" key={`${card.key}-${hide}`}>
                  <p className="wrapped-eyebrow">{card.eyebrow}</p>
                  {card.cents !== undefined && !hide ? <CountUp cents={card.cents} className="wrapped-big" /> : <p className="wrapped-big">{big}</p>}
                  {line && <p className="wrapped-title">{line}</p>}
                  <div className="wrapped-lines">{lines.map((l, i) => <p key={i} style={{ animationDelay: `${0.25 + i * 0.12}s` }}>{l}</p>)}</div>
                </div>
              )
            })()}
          </div>
        )}
      <div className="wrapped-foot">
        <label className="wrapped-toggle">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> Nur Prozente
        </label>
        {card && <button className="wrapped-share" onClick={share}><Share size={18} aria-hidden="true" /> Karte teilen</button>}
      </div>
    </div>
  )
  return createPortal(content, document.querySelector('.app')!)
}
