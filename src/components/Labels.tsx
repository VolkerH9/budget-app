import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, Check, Plus, X } from 'lucide-react'
import { db, LABEL_COLORS, LABEL_KINDS, newId, type Category, type Entry, type Label, type LabelKind } from '../db'
import { useApp, useCategories, useGroups, useLabels } from '../context'
import { formatDate, today } from '../lib/dates'
import { amountToInput, formatEuro, formatPercent, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { applyBulk, daysLeft, isActiveOn, labelSummary, type BulkAction } from '../lib/labels'
import { budgetLevel } from '../lib/stats'
import { CategoryIcon, categoryText, ICONS } from './CategoryIcon'
import { Ring } from './Ring'
import { CountUp, Segmented, Sheet } from './ui'

const EMOJIS = ['🏔️', '⛷️', '🏖️', '✈️', '🚗', '🏕️', '🎉', '🎂', '💍', '🎄', '🎁', '🏠', '🛠️', '🎓', '💼', '🎸', '⚽️', '🍷', '👶', '🐶', '❤️', '🌍', '📸', '⭐️']

/** Emoji or line icon of a label */
export function LabelGlyph({ label, size = 15 }: { label: Pick<Label, 'emoji' | 'icon' | 'symbol'>; size?: number }) {
  const Glyph = label.symbol === 'icon' && label.icon ? ICONS[label.icon] : undefined
  return Glyph ? <Glyph size={size} strokeWidth={2} aria-hidden="true" /> : <span aria-hidden="true" style={{ fontSize: size }}>{label.emoji}</span>
}

/** Coloured chip; pressed chips are filled more strongly */
export function LabelChip({ label, pressed, onClick, small }: { label: Label; pressed?: boolean; onClick?: () => void; small?: boolean }) {
  const style = { '--c': label.color } as React.CSSProperties
  const className = `label-chip${small ? ' small' : ''}${pressed === false ? ' off' : ''}`
  const content = <><LabelGlyph label={label} size={small ? 12 : 15} /><span>{label.name}</span></>
  return onClick
    ? <button type="button" className={className} style={style} aria-pressed={pressed} onClick={onClick}>{content}{pressed && <X size={13} strokeWidth={2.4} aria-hidden="true" />}</button>
    : <span className={className} style={style}>{content}</span>
}

export const periodText = (label: Label) => {
  if (label.from && label.to) return `${formatDate(label.from)} – ${formatDate(label.to)}`
  if (label.from) return `ab ${formatDate(label.from)}`
  if (label.to) return `bis ${formatDate(label.to)}`
  return 'Ohne Zeitraum, nur von Hand'
}

/** Create or edit a label in one sheet: name, colour, symbol, kind, period, budget. */
export function LabelSheet({ label, onClose, onSaved }: { label?: Label; onClose: () => void; onSaved?: (id: string) => void }) {
  const { alert, toast } = useApp()
  const [name, setName] = useState(label?.name ?? '')
  const [color, setColor] = useState(label?.color ?? LABEL_COLORS[0])
  const [emoji, setEmoji] = useState(label?.emoji ?? '🏔️')
  const [icon, setIcon] = useState(label?.icon ?? 'plane')
  const [symbol, setSymbol] = useState<'icon' | 'emoji'>(label?.symbol ?? 'emoji')
  const [kind, setKind] = useState<LabelKind | undefined>(label?.kind)
  const [from, setFrom] = useState(label?.from ?? '')
  const [to, setTo] = useState(label?.to ?? '')
  const [budget, setBudget] = useState(label?.budget ? amountToInput(label.budget) : '')
  const cents = budget.trim() ? parseAmount(budget) : null
  const valid = !!name.trim() && (!budget.trim() || cents !== null) && !(from && to && to < from)

  const save = async () => {
    if (!valid) return
    const values = {
      name: name.trim(), color, emoji: emoji.trim() || '🏷️', icon, symbol, kind,
      from: from || undefined, to: to || undefined, budget: cents ?? undefined,
    }
    const id = label?.id ?? newId()
    if (label) await db.labels.put({ ...label, ...values })
    else await db.labels.add({ ...values, id, createdAt: Date.now() })
    haptic()
    toast(label ? 'Label gespeichert' : 'Label angelegt')
    onClose()
    onSaved?.(id)
  }

  const remove = () => {
    if (!label) return
    alert({
      title: `„${label.name}“ löschen?`,
      message: 'Das Label verschwindet von allen Buchungen. Die Buchungen selbst bleiben. Zum Aufheben ohne Löschen gibt es „Archivieren“.',
      buttons: [
        {
          label: 'Löschen', style: 'destructive', onClick: async () => {
            const tagged = await db.entries.where('labels').equals(label.id).toArray()
            await db.transaction('rw', db.entries, db.labels, async () => {
              await db.entries.bulkPut(applyBulk(tagged, { kind: 'removeLabel', labelId: label.id }))
              await db.labels.delete(label.id)
            })
            toast('Label gelöscht')
            onClose()
          },
        },
        { label: 'Abbrechen', style: 'strong' },
      ],
    })
  }

  const preview: Label = { id: 'preview', name: name || 'Neues Label', color, emoji, icon, symbol, createdAt: 0 }
  return (
    <Sheet title={label ? 'Label bearbeiten' : 'Neues Label'} onClose={onClose} full action={{ label: 'Sichern', disabled: !valid, onClick: save }}>
      <div className="label-preview"><LabelChip label={preview} /></div>
      <div className="group">
        <label className="row">
          <input className="left" type="text" placeholder="Name, z. B. Skiurlaub Tirol 2026" aria-label="Name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>

      <h3 className="section-title">Farbe</h3>
      <div className="group swatches">
        {LABEL_COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Farbe ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />)}
      </div>

      <h3 className="section-title">Art</h3>
      <div className="chips wrap">
        {LABEL_KINDS.map(([key, text, iconName]) => {
          const Glyph = ICONS[iconName]
          return (
            <button key={key} className="chip kind-chip" aria-pressed={kind === key} onClick={() => {
              setKind(kind === key ? undefined : key)
              if (kind !== key && symbol === 'icon') setIcon(iconName)
            }}>
              <Glyph size={16} strokeWidth={1.9} aria-hidden="true" /> {text}
            </button>
          )
        })}
      </div>

      <h3 className="section-title">Symbol</h3>
      <Segmented value={symbol} options={[['emoji', 'Emoji'], ['icon', 'Icon']]} onChange={setSymbol} />
      <div className="group" style={{ marginTop: 10 }}>
        {symbol === 'icon'
          ? (
            <div className="emoji-grid">
              {Object.entries(ICONS).map(([key, Glyph]) => (
                <button key={key} aria-label={key} aria-pressed={key === icon} onClick={() => setIcon(key)}><Glyph size={22} strokeWidth={1.8} /></button>
              ))}
            </div>
          )
          : (
            <>
              <div className="row">
                <span className="row-main">Eigenes Emoji</span>
                <input type="text" aria-label="Eigenes Emoji" style={{ flex: '0 0 60px' }} value={emoji} onChange={(e) => setEmoji([...e.target.value].slice(-2).join(''))} />
              </div>
              <div className="emoji-grid">
                {EMOJIS.map((e) => <button key={e} aria-pressed={e === emoji} onClick={() => setEmoji(e)}>{e}</button>)}
              </div>
            </>
          )}
      </div>

      <h3 className="section-title">Zeitraum (optional)</h3>
      <div className="group">
        <label className="row">
          <span className="row-main">Von</span>
          <input type="date" aria-label="Von" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="row">
          <span className="row-main">Bis</span>
          <input type="date" aria-label="Bis" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && <button className="row tint" onClick={() => { setFrom(''); setTo('') }}>Zeitraum entfernen</button>}
      </div>
      <p className="section-foot">
        {from && to && to < from ? 'Das Ende liegt vor dem Anfang.' : 'In diesem Zeitraum ist das Label bei neuen Buchungen schon ausgewählt. Ohne Zeitraum setzt du es nur von Hand.'}
      </p>

      <h3 className="section-title">Budget (optional)</h3>
      <div className="group">
        <label className="row">
          <span className="row-main">Betrag in €</span>
          <input type="text" inputMode="decimal" placeholder="z. B. 800" aria-label="Budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
      </div>

      {label && (
        <div className="group" style={{ marginTop: 24 }}>
          <button className="row tint" onClick={async () => { await db.labels.update(label.id, { archived: !label.archived }); toast(label.archived ? 'Label wiederhergestellt' : 'Label archiviert'); onClose() }}>
            <Archive size={18} strokeWidth={1.8} aria-hidden="true" /> {label.archived ? 'Aus dem Archiv holen' : 'Archivieren'}
          </button>
          <button className="row danger" onClick={remove}>Label löschen</button>
        </div>
      )}
      <div style={{ height: 24 }} />
    </Sheet>
  )
}

/** Picks labels by hand: all labels that are not archived, plus creating a new one */
export function LabelPicker({ selected, onToggle, onClose, title = 'Labels' }: { selected: string[]; onToggle: (id: string) => void; onClose: () => void; title?: string }) {
  const labels = useLabels().filter((l) => !l.archived || selected.includes(l.id))
  const [creating, setCreating] = useState(false)
  return (
    <Sheet title={title} onClose={onClose} action={{ label: 'Fertig', onClick: onClose }}>
      <div className="group">
        {labels.map((l) => (
          <button key={l.id} className="row" role="checkbox" aria-checked={selected.includes(l.id)} onClick={() => { haptic(); onToggle(l.id) }}>
            <span className={selected.includes(l.id) ? 'check on' : 'check'} aria-hidden="true">{selected.includes(l.id) && <Check size={16} strokeWidth={3} />}</span>
            <span className="row-main"><LabelChip label={l} /></span>
            <span className="row-sub">{l.from || l.to ? periodText(l) : ''}</span>
          </button>
        ))}
        <button className="row tint" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" /> Neues Label</button>
      </div>
      {labels.length === 0 && <p className="section-foot">Noch keine Labels. Lege eins an, z. B. für einen Urlaub.</p>}
      <div style={{ height: 16 }} />
      {creating && <LabelSheet onClose={() => setCreating(false)} onSaved={(id) => onToggle(id)} />}
    </Sheet>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Moves the entries of a label to another category, with a list of the categories that fit */
function CategoryChoice({ entries, onPick, onClose }: { entries: Entry[]; onPick: (c: Category) => void; onClose: () => void }) {
  const categories = useCategories()
  const types = new Set(entries.map((e) => e.type))
  return (
    <Sheet title="Kategorie ändern" onClose={onClose}>
      <p className="section-foot">Alle Buchungen des Labels mit passender Art kommen in die gewählte Kategorie.</p>
      <div className="group">
        {categories.filter((c) => types.has(c.type)).map((c) => (
          <button key={c.id} className="row" onClick={() => { onClose(); onPick(c) }}>
            <CategoryIcon category={c} size={28} />
            <span className="row-main">{categoryText({ ...c, symbol: 'icon' })}</span>
          </button>
        ))}
      </div>
      <div style={{ height: 16 }} />
    </Sheet>
  )
}

/** One label: sums, split by category, budget, all entries and the bulk actions. */
export function LabelDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { alert, toast, openEntry } = useApp()
  const label = useLiveQuery(() => db.labels.get(id), [id])
  const labels = useLabels()
  const categories = useCategories()
  const groups = useGroups()
  const tagged = useLiveQuery(() => db.entries.where('labels').equals(id).toArray(), [id], [] as Entry[])
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState<'add' | 'remove' | 'category' | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const now = today()
  const summary = useMemo(() => (label ? labelSummary(tagged, label, categories, groups, now) : null), [label, tagged, categories, groups, now])
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  if (label === undefined || !summary) return null
  if (label === null) return null

  const run = (action: BulkAction, description: string) => {
    const changed = applyBulk(tagged, action)
    if (changed.length === 0) {
      alert({ title: 'Nichts zu ändern', message: 'Keine Buchung dieses Labels ist davon betroffen.', buttons: [{ label: 'OK', style: 'strong' }] })
      return
    }
    const before = tagged.filter((e) => changed.some((c) => c.id === e.id))
    const sum = before.reduce((s, e) => s + e.amount, 0)
    alert({
      title: description,
      message: `${plural(changed.length, 'Buchung', 'Buchungen')} über ${formatEuro(sum)} ${changed.length === 1 ? 'wird' : 'werden'} geändert. Du kannst es danach rückgängig machen.`,
      buttons: [
        {
          label: 'Ausführen', style: 'strong', onClick: async () => {
            await db.entries.bulkPut(changed)
            haptic()
            toast(`${plural(changed.length, 'Buchung', 'Buchungen')} geändert`, () => { db.entries.bulkPut(before) })
          },
        },
        { label: 'Abbrechen' },
      ],
    })
  }

  const left = daysLeft(label, now)
  const active = isActiveOn(label, now)
  const level = label.budget ? budgetLevel(summary.total, label.budget) : null
  const otherLabels = labels.filter((l) => l.id !== id)
  const onEntries = otherLabels.filter((l) => tagged.some((e) => e.labels?.includes(l.id)))

  return (
    <Sheet title="Label" onClose={onClose} full action={{ label: 'Bearbeiten', onClick: () => setEditing(true) }}>
      <div className="card label-hero" style={{ '--c': label.color } as React.CSSProperties}>
        <div className="label-hero-head">
          <LabelChip label={label} />
          {label.archived ? <span className="badge">Archiviert</span> : active ? <span className="badge status-partial">aktiv{left !== null ? ` · noch ${plural(left, 'Tag', 'Tage')}` : ''}</span> : null}
        </div>
        <span className="row-sub">{periodText(label)}</span>
        <CountUp cents={summary.total} className="hero-num" />
        <div className="mini-stats num">
          <span>{plural(summary.count, 'Buchung', 'Buchungen')}</span>
          {summary.perDay !== null && <span>{formatEuro(summary.perDay)} pro Tag</span>}
          {summary.income > 0 && <span>{formatEuro(summary.income)} Einnahmen</span>}
        </div>
        {label.budget && level && (
          <div className="label-budget">
            <div className={`bar ${level}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((summary.total / label.budget) * 100))} aria-label="Budget">
              <div style={{ width: `${Math.min(100, (summary.total / label.budget) * 100)}%` }} />
            </div>
            <div className="budget-foot num">
              <span>{formatPercent(summary.total / label.budget)} von {formatEuro(label.budget)}</span>
              <span className={label.budget - summary.total < 0 ? 'danger' : undefined}>
                {label.budget - summary.total < 0 ? `${formatEuro(summary.total - label.budget)} drüber` : `${formatEuro(label.budget - summary.total)} übrig`}
              </span>
            </div>
          </div>
        )}
      </div>

      {summary.byGroup.length > 0 && (
        <>
          <h3 className="section-title">Nach Bereichen</h3>
          <div className="card">
            <Ring segments={summary.byGroup} total={summary.total} title={label.name} selected={selected} onSelect={setSelected} />
            <div className="legend-list">
              {summary.byGroup.map((g) => (
                <div key={g.key} className="legend-row" aria-pressed={g.key === selected}>
                  {g.group ? <span className="dot" style={{ background: g.color }} /> : <CategoryIcon category={g.categories[0]} size={26} />}
                  <span className="row-main row-title">{g.label}</span>
                  <span className="row-sub num">{formatPercent(g.share)}</span>
                  <span className="num legend-amount">{formatEuro(g.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <h3 className="section-title">Nach Kategorien</h3>
          <div className="group">
            {summary.byCategory.map((p) => (
              <div key={p.category.id} className="row">
                <CategoryIcon category={p.category} size={28} />
                <span className="row-main">
                  <span className="row-title" style={{ display: 'block' }}>{p.category.name}</span>
                  <span className="row-sub" style={{ display: 'block' }}>{plural(p.count, 'Buchung', 'Buchungen')} · {formatPercent(p.share)}</span>
                </span>
                <span className="row-value num" style={{ color: 'var(--label)' }}>{formatEuro(p.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="section-title">Buchungen</h3>
      {summary.entries.length === 0
        ? <div className="empty" style={{ padding: '24px 8px' }}><b>Noch keine Buchungen</b>{active ? 'Neue Buchungen bekommen das Label automatisch.' : 'Weise das Label im Eintragsformular oder in der Liste zu.'}</div>
        : (
          <div className="group">
            {summary.entries.map((e) => (
              <button key={e.id} className="row" onClick={() => openEntry(e)}>
                <CategoryIcon category={byId.get(e.categoryId)} size={30} />
                <span className="row-main">
                  <span className="row-title" style={{ display: 'block' }}>{e.merchant || e.note || byId.get(e.categoryId)?.name}</span>
                  <span className="row-sub" style={{ display: 'block' }}>{formatDate(e.date)} · {byId.get(e.categoryId)?.name}{e.forParents ? ' · Eltern' : ''}</span>
                </span>
                <span className="row-value num">{e.type === 'income' ? '+' : '−'}{formatEuro(e.amount)}</span>
              </button>
            ))}
          </div>
        )}

      {summary.entries.length > 0 && (
        <>
          <h3 className="section-title">Für alle Buchungen dieses Labels</h3>
          <div className="group">
            <button className="row tint" onClick={() => run({ kind: 'parents', on: true }, 'Als Eltern-Kosten markieren?')}>Als Eltern-Kosten markieren</button>
            <button className="row tint" onClick={() => run({ kind: 'parents', on: false }, 'Eltern-Markierung entfernen?')}>Eltern-Markierung entfernen</button>
            <button className="row tint" onClick={() => setPicking('category')}>Kategorie ändern</button>
            {otherLabels.length > 0 && <button className="row tint" onClick={() => setPicking('add')}>Weiteres Label hinzufügen</button>}
            {onEntries.length > 0 && <button className="row tint" onClick={() => setPicking('remove')}>Weiteres Label entfernen</button>}
          </div>
          <p className="section-foot">Vor jeder Änderung siehst du, wie viele Buchungen betroffen sind. Danach kannst du sie rückgängig machen.</p>
        </>
      )}
      {/* Room below, so the Rückgängig message never covers the last action */}
      <div style={{ height: 96 }} />

      {editing && <LabelSheet label={label} onClose={() => setEditing(false)} />}
      {picking === 'category' && <CategoryChoice entries={tagged} onClose={() => setPicking(null)} onPick={(c) => run({ kind: 'category', category: c }, `Nach „${c.name}“ verschieben?`)} />}
      {(picking === 'add' || picking === 'remove') && (
        <Sheet title={picking === 'add' ? 'Label hinzufügen' : 'Label entfernen'} onClose={() => setPicking(null)}>
          <div className="group">
            {(picking === 'add' ? otherLabels.filter((l) => !l.archived) : onEntries).map((l) => (
              <button key={l.id} className="row" onClick={() => {
                setPicking(null)
                run(picking === 'add' ? { kind: 'addLabel', labelId: l.id } : { kind: 'removeLabel', labelId: l.id }, picking === 'add' ? `„${l.name}“ hinzufügen?` : `„${l.name}“ entfernen?`)
              }}>
                <span className="row-main"><LabelChip label={l} /></span>
              </button>
            ))}
          </div>
          <div style={{ height: 16 }} />
        </Sheet>
      )}
    </Sheet>
  )
}

/** Settings › Labels: active, upcoming, other and archived labels */
export function LabelsList({ onOpen }: { onOpen: (id: string) => void }) {
  const labels = useLabels()
  const totals = useLiveQuery(async () => {
    const map = new Map<string, number>()
    for (const e of await db.entries.filter((x) => !!x.labels?.length && x.type === 'expense').toArray()) {
      for (const id of e.labels!) map.set(id, (map.get(id) ?? 0) + e.amount)
    }
    return map
  }, [], new Map<string, number>())
  const [creating, setCreating] = useState(false)
  const now = today()
  const sections: [string, Label[]][] = [
    ['Aktiv', labels.filter((l) => isActiveOn(l, now))],
    ['Geplant', labels.filter((l) => !l.archived && !!l.from && l.from > now)],
    ['Weitere', labels.filter((l) => !l.archived && !isActiveOn(l, now) && !(l.from && l.from > now))],
    ['Archiviert', labels.filter((l) => l.archived)],
  ]
  return (
    <>
      <button className="primary-btn" onClick={() => setCreating(true)}>Neues Label</button>
      {labels.length === 0 && <p className="section-foot">Mit Labels markierst du Buchungen zusätzlich zur Kategorie, z. B. alles vom Skiurlaub. Mit einem Zeitraum bekommen neue Buchungen das Label automatisch.</p>}
      {sections.filter(([, list]) => list.length > 0).map(([title, list]) => (
        <section key={title}>
          <h2 className="section-title">{title}</h2>
          <div className="group">
            {list.map((l) => (
              <button key={l.id} className="row" onClick={() => onOpen(l.id)}>
                <span className="row-main">
                  <LabelChip label={l} />
                  <span className="row-sub" style={{ display: 'block', marginTop: 3 }}>{periodText(l)}{l.budget ? ` · Budget ${formatEuro(l.budget)}` : ''}</span>
                </span>
                <span className="row-value num">{formatEuro(totals.get(l.id) ?? 0)}</span>
                <span className="chevron" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {creating && <LabelSheet onClose={() => setCreating(false)} onSaved={onOpen} />}
    </>
  )
}
