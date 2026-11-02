import { useRef, useState, type ReactNode } from 'react'

const OPEN = -160
let closeOpenRow: (() => void) | null = null

/** List row that reveals Bearbeiten and Löschen when swiped left, as in iOS Mail. */
export function SwipeRow({ children, onEdit, onDelete }: { children: ReactNode; onEdit: () => void; onDelete: () => void }) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; base: number; horizontal: boolean | null } | null>(null)
  const justDragged = useRef(false)

  const close = () => setOffset(0)

  return (
    <div className="swipe">
      <div className="swipe-actions" style={{ visibility: offset === 0 ? 'hidden' : 'visible' }}>
        <button className="edit" onClick={() => { close(); onEdit() }}>Bearbeiten</button>
        <button className="delete" onClick={() => { close(); onDelete() }}>Löschen</button>
      </div>
      <div
        className={dragging ? 'swipe-content' : 'swipe-content animate'}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          justDragged.current = false
          if (closeOpenRow && offset === 0) closeOpenRow()
          drag.current = { x: e.clientX, y: e.clientY, base: offset, horizontal: null }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (d.horizontal === null) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
            d.horizontal = Math.abs(dx) > Math.abs(dy)
            if (d.horizontal) {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setDragging(true)
            }
          }
          if (d.horizontal) setOffset(Math.max(OPEN - 30, Math.min(0, d.base + dx)))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          setDragging(false)
          if (!d?.horizontal) return
          justDragged.current = true
          const opened = e.clientX - d.x + d.base < OPEN / 2
          setOffset(opened ? OPEN : 0)
          closeOpenRow = opened ? close : null
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
          setOffset(0)
        }}
        onClickCapture={(e) => {
          // The click that ends a drag must neither close the row nor open the entry
          if (justDragged.current) {
            justDragged.current = false
            e.stopPropagation()
          } else if (offset !== 0) {
            e.stopPropagation()
            close()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
