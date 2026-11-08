import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { loadPhoto } from '../lib/vault'

/** A stored photo by id, or one that is not saved yet */
export interface PhotoSource {
  id: string
  blob?: Blob
}

/** Object URL of a photo, null while it loads, 'missing' when it is not on the device. */
export function usePhotoUrl(source: PhotoSource | undefined): string | null | 'missing' {
  const [url, setUrl] = useState<string | null | 'missing'>(null)
  const id = source?.id
  const given = source?.blob
  useEffect(() => {
    if (!id) return
    let made: string | null = null
    let alive = true
    setUrl(null)
    const blob = given ? Promise.resolve(given) : loadPhoto(id)
    blob.then((b) => {
      if (!alive) return
      if (!b) {
        setUrl('missing')
        return
      }
      made = URL.createObjectURL(b)
      setUrl(made)
    }).catch(() => alive && setUrl('missing'))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [id, given])
  return url
}

export function PhotoThumb({ source, className = 'photo-thumb' }: { source: PhotoSource; className?: string }) {
  const url = usePhotoUrl(source)
  return url && url !== 'missing' ? <img className={className} src={url} alt="" /> : <span className={`${className} empty`} />
}

interface View {
  scale: number
  x: number
  y: number
}

const MAX_SCALE = 6
const NONE: View = { scale: 1, x: 0, y: 0 }

/** Full screen photo with pinch zoom, double tap and swiping between several photos. */
export function PhotoViewer({ photos, start = 0, caption, onClose, onReplace, onDelete }: {
  photos: PhotoSource[]
  start?: number
  caption?: string
  onClose: () => void
  onReplace?: (index: number) => void
  onDelete?: (index: number) => void
}) {
  const [index, setIndex] = useState(Math.min(start, photos.length - 1))
  const [view, setView] = useState<View>(NONE)
  const [animate, setAnimate] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ view: View; distance: number; mid: { x: number; y: number }; start: { x: number; y: number }; moved: boolean } | null>(null)
  const lastTap = useRef(0)
  const url = usePhotoUrl(photos[index])

  useEffect(() => {
    if (photos.length === 0) onClose()
    else if (index >= photos.length) setIndex(photos.length - 1)
  }, [photos.length, index, onClose])

  useEffect(() => setView(NONE), [index])

  /** Keeps the zoomed photo from sliding out of view */
  const clamp = (v: View): View => {
    const box = stage.current?.getBoundingClientRect()
    const scale = Math.max(1, Math.min(MAX_SCALE, v.scale))
    if (!box || scale === 1) return { scale, x: 0, y: 0 }
    const maxX = ((scale - 1) * box.width) / 2
    const maxY = ((scale - 1) * box.height) / 2
    return { scale, x: Math.max(-maxX, Math.min(maxX, v.x)), y: Math.max(-maxY, Math.min(maxY, v.y)) }
  }

  /** Point relative to the middle of the stage */
  const local = (x: number, y: number) => {
    const box = stage.current!.getBoundingClientRect()
    return { x: x - box.left - box.width / 2, y: y - box.top - box.height / 2 }
  }

  const begin = () => {
    const list = [...pointers.current.values()]
    const mid = list.length === 2 ? { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 } : list[0]
    const distance = list.length === 2 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0
    gesture.current = { view, distance, mid, start: gesture.current?.start ?? list[0], moved: gesture.current?.moved ?? false }
  }

  const go = (step: number) => {
    const next = index + step
    if (next >= 0 && next < photos.length) setIndex(next)
  }

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Belegfoto">
      <div className="viewer-head">
        <span className="num">{photos.length > 1 ? `${index + 1} / ${photos.length}` : ''}</span>
        <button onClick={onClose}>Fertig</button>
      </div>
      <div
        ref={stage}
        className="viewer-stage"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          e.currentTarget.setPointerCapture?.(e.pointerId)
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (pointers.current.size === 1) gesture.current = null
          setAnimate(false)
          begin()
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          const g = gesture.current
          if (!g) return
          const list = [...pointers.current.values()]
          if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 10) g.moved = true
          if (list.length === 2 && g.distance > 0) {
            const mid = { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 }
            const scale = Math.max(1, Math.min(MAX_SCALE, g.view.scale * (Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) / g.distance)))
            const m = local(g.mid.x, g.mid.y)
            const ratio = scale / g.view.scale
            setView(clamp({ scale, x: m.x - (m.x - g.view.x) * ratio + (mid.x - g.mid.x), y: m.y - (m.y - g.view.y) * ratio + (mid.y - g.mid.y) }))
          } else if (list.length === 1 && g.view.scale > 1) {
            setView(clamp({ ...g.view, x: g.view.x + e.clientX - g.mid.x, y: g.view.y + e.clientY - g.mid.y }))
          }
        }}
        onPointerUp={(e) => {
          const g = gesture.current
          pointers.current.delete(e.pointerId)
          if (pointers.current.size > 0) {
            begin()
            return
          }
          if (!g) return
          const dx = e.clientX - g.start.x
          if (!g.moved) {
            // Double tap zooms in on the spot, or back out
            const now = Date.now()
            if (now - lastTap.current < 300) {
              setAnimate(true)
              const m = local(e.clientX, e.clientY)
              setView(view.scale > 1 ? NONE : clamp({ scale: 2.5, x: -m.x * 1.5, y: -m.y * 1.5 }))
              lastTap.current = 0
            } else {
              lastTap.current = now
            }
          } else if (g.view.scale === 1 && view.scale === 1 && Math.abs(dx) > 60) {
            go(dx < 0 ? 1 : -1)
          }
          gesture.current = null
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          gesture.current = null
        }}
      >
        {url === 'missing'
          ? <p className="viewer-missing">Dieses Foto ist auf dem iPhone nicht mehr vorhanden.</p>
          : url && (
            <img
              src={url}
              alt={caption ? `Beleg: ${caption}` : 'Beleg'}
              draggable={false}
              className={animate ? 'animate' : undefined}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            />
          )}
        {photos.length > 1 && index > 0 && <button className="viewer-nav prev" aria-label="Vorheriges Foto" onClick={() => go(-1)}><ChevronLeft size={26} /></button>}
        {photos.length > 1 && index < photos.length - 1 && <button className="viewer-nav next" aria-label="Nächstes Foto" onClick={() => go(1)}><ChevronRight size={26} /></button>}
      </div>
      <div className="viewer-foot">
        {caption && <span className="viewer-caption">{caption}</span>}
        {(onReplace || onDelete) && (
          <div className="viewer-actions">
            {onReplace && <button onClick={() => onReplace(index)}>Ersetzen</button>}
            {onDelete && <button className="danger" onClick={() => onDelete(index)}>Löschen</button>}
          </div>
        )}
        {!caption && !onReplace && !onDelete && <span className="viewer-caption">Zum Vergrößern zwei Finger spreizen oder doppelt tippen</span>}
      </div>
    </div>,
    document.querySelector('.app')!,
  )
}
