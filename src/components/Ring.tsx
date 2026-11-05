import { formatEuro, formatPercent } from '../lib/format'
import { useTheme } from '../lib/theme'
import { CountUp } from './ui'

export interface RingSegment {
  key: string
  label: string
  color: string
  amount: number
  share: number
}

const SIZE = 240
const C = SIZE / 2

function arc(r: number, start: number, end: number): string {
  const point = (angle: number) => [C + r * Math.sin(angle), C - r * Math.cos(angle)]
  const [x1, y1] = point(start)
  const [x2, y2] = point(end)
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

/** Ring chart. Tapping a segment highlights it and shows its numbers in the middle. */
export function Ring({ segments, total, title, selected, onSelect }: {
  segments: RingSegment[]
  total: number
  title: string
  selected: string | null
  onSelect: (key: string | null) => void
}) {
  const hud = useTheme() === 'hud'
  const r = hud ? 90 : 94
  const width = hud ? 9 : 24
  // A 2 px gap of the card colour between neighbours
  const gap = segments.length > 1 ? 2 / r + (hud ? 0.02 : 0) : 0
  const active = segments.find((s) => s.key === selected)
  let angle = 0

  return (
    <div className="ring-wrap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="ring" role="img" aria-label={`${title}: ${formatEuro(total)}`}>
        {hud && (
          <g className="ring-scale" aria-hidden="true">
            {Array.from({ length: 72 }, (_, i) => {
              const a = (i / 72) * Math.PI * 2
              const long = i % 6 === 0
              const [r1, r2] = [108, long ? 116 : 112]
              return <line key={i} x1={C + r1 * Math.sin(a)} y1={C - r1 * Math.cos(a)} x2={C + r2 * Math.sin(a)} y2={C - r2 * Math.cos(a)} />
            })}
            <circle cx={C} cy={C} r={74} />
            <circle cx={C} cy={C} r={r} className="ring-track" style={{ strokeWidth: width }} />
          </g>
        )}
        {segments.map((s, i) => {
          const sweep = s.share * Math.PI * 2
          const start = angle + gap / 2
          const end = angle + sweep - gap / 2
          angle += sweep
          const dim = selected !== null && s.key !== selected
          const d = segments.length === 1 ? arc(r, 0, Math.PI * 2 - 0.0001) : arc(r, start, Math.max(start + 0.001, end))
          return (
            <g key={s.key} className="ring-seg" style={{ animationDelay: `${i * 60}ms` }}>
              <path d={d} pathLength={1} fill="none" stroke={s.color} strokeWidth={s.key === selected ? width + (hud ? 4 : 6) : width}
                strokeLinecap="butt" opacity={dim ? 0.3 : 1} className="ring-arc" />
              <path d={d} fill="none" stroke="transparent" strokeWidth={34} className="ring-hit"
                role="button" aria-label={`${s.label}: ${formatEuro(s.amount)}, ${formatPercent(s.share)}`}
                onClick={() => onSelect(s.key === selected ? null : s.key)} />
            </g>
          )
        })}
      </svg>
      <div className="ring-center">
        <small>{active ? active.label : title}</small>
        {active ? <strong className="num">{formatEuro(active.amount)}</strong> : <CountUp cents={total} className="ring-total" />}
        {active && <small className="num">{formatPercent(active.share)} der Ausgaben</small>}
      </div>
    </div>
  )
}
