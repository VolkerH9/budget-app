import { useState } from 'react'
import { db, newId, PALETTE, type Category, type EntryType, type Group } from '../db'
import { useApp, useCategories, useGroups } from '../context'
import { CategoryIcon, ICONS } from '../components/CategoryIcon'
import { Icon } from '../components/Icon'
import { TYPE_OPTIONS } from '../components/EntrySheet'
import { Segmented, Sheet } from '../components/ui'
import { SubPage } from './Settings'

const COLORS = [...PALETTE, '#5d8aa8', '#8d7b68', '#6b8f5e', '#b0607f', '#7a7fa8', '#8e8e93']
const EMOJIS = ['🛒', '🍽️', '☕️', '🍕', '🍺', '🧴', '💊', '🛍️', '👕', '👟', '🏃', '⚽️', '🎬', '🎮', '🎵', '🎁', '✈️', '🏖️', '🚗', '🚲', '🚆', '⛽️', '🏠', '💡', '📱', '💻', '🎓', '📚', '📺', '🐶', '👶', '❤️', '📦', '💰', '📈', '💼', '🏦', '🎉', '🔧', '🌱', '👪', '👵']

function CategorySheet({ category, type, groups, onClose, onDelete }: {
  category?: Category
  type: EntryType
  groups: Group[]
  onClose: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [emoji, setEmoji] = useState(category?.emoji ?? '📦')
  const [icon, setIcon] = useState(category?.icon ?? 'package')
  const [symbol, setSymbol] = useState<'icon' | 'emoji'>(category?.symbol ?? 'icon')
  const [color, setColor] = useState(category?.color ?? COLORS[0])
  const [groupId, setGroupId] = useState(category?.groupId ?? '')

  const save = async () => {
    const values = { name: name.trim(), emoji: emoji.trim() || '📦', icon, symbol, color, groupId: groupId || undefined }
    if (category) {
      await db.categories.update(category.id, values)
    } else {
      const last = await db.categories.where('type').equals(type).sortBy('order')
      await db.categories.add({ ...values, id: newId(), type, order: (last.at(-1)?.order ?? -1) + 1 })
    }
    onClose()
  }

  return (
    <Sheet title={category ? 'Kategorie bearbeiten' : 'Neue Kategorie'} onClose={onClose} full action={{ label: 'Sichern', disabled: !name.trim(), onClick: save }}>
      <div className="group">
        <div className="row">
          <CategoryIcon category={{ emoji, icon, symbol, color }} />
          <input className="left" type="text" placeholder="Name" aria-label="Name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="row">
          <span className="row-main">Überkategorie</span>
          <select aria-label="Überkategorie" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Keine</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
      <h3 className="section-title">Farbe</h3>
      <div className="group swatches">
        {COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Farbe ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />)}
      </div>
      <h3 className="section-title">Symbol</h3>
      <Segmented value={symbol} options={[['icon', 'Icon'], ['emoji', 'Emoji']]} onChange={setSymbol} />
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
      {category && <button className="row center danger" style={{ marginTop: 24, borderRadius: 12 }} onClick={onDelete}>Kategorie löschen</button>}
    </Sheet>
  )
}

function GroupSheet({ group, type, onClose }: { group?: Group; type: EntryType; onClose: () => void }) {
  const { alert, toast } = useApp()
  const [name, setName] = useState(group?.name ?? '')
  const [color, setColor] = useState(group?.color ?? COLORS[0])

  const save = async () => {
    if (group) {
      await db.groups.update(group.id, { name: name.trim(), color })
    } else {
      const last = await db.groups.where('type').equals(type).sortBy('order')
      await db.groups.add({ id: newId(), type, name: name.trim(), color, order: (last.at(-1)?.order ?? -1) + 1 })
    }
    onClose()
  }

  const remove = () => alert({
    title: `„${group!.name}“ löschen?`,
    message: 'Die Kategorien darin bleiben mit allen Einträgen erhalten und stehen danach ohne Überkategorie da.',
    buttons: [
      {
        label: 'Löschen',
        style: 'destructive',
        onClick: async () => {
          await db.transaction('rw', db.groups, db.categories, async () => {
            await db.categories.where('groupId').equals(group!.id).modify((c) => { delete c.groupId })
            await db.groups.delete(group!.id)
          })
          toast(`„${group!.name}“ gelöscht`)
          onClose()
        },
      },
      { label: 'Abbrechen', style: 'strong' },
    ],
  })

  return (
    <Sheet title={group ? 'Überkategorie' : 'Neue Überkategorie'} onClose={onClose} action={{ label: 'Sichern', disabled: !name.trim(), onClick: save }}>
      <div className="group">
        <div className="row">
          <span className="dot big" style={{ background: color }} />
          <input className="left" type="text" placeholder="Name, z. B. Wohnen" aria-label="Name der Überkategorie" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <h3 className="section-title">Farbe im Ring-Diagramm</h3>
      <div className="group swatches">
        {COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Farbe ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />)}
      </div>
      {group && <button className="row center danger" style={{ marginTop: 24, borderRadius: 12 }} onClick={remove}>Überkategorie löschen</button>}
    </Sheet>
  )
}

function MoveSheet({ category, targets, onClose }: { category: Category; targets: Category[]; onClose: () => void }) {
  const { toast } = useApp()
  const move = async (target: Category) => {
    await db.transaction('rw', db.entries, db.recurring, db.categories, async () => {
      await db.entries.where('categoryId').equals(category.id).modify({ categoryId: target.id })
      await db.recurring.where('categoryId').equals(category.id).modify({ categoryId: target.id })
      await db.categories.delete(category.id)
    })
    toast(`„${category.name}“ gelöscht, Einträge verschoben`)
    onClose()
  }
  return (
    <Sheet title="Verschieben nach" onClose={onClose}>
      <div className="group">
        {targets.map((c) => (
          <button key={c.id} className="row" onClick={() => move(c)}>
            <CategoryIcon category={c} />
            <span className="row-main row-title">{c.name}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function CategoriesPage({ onBack }: { onBack: () => void }) {
  const { alert, toast } = useApp()
  const categories = useCategories()
  const allGroups = useGroups()
  const [type, setType] = useState<EntryType>('expense')
  const [editing, setEditing] = useState<{ category?: Category } | null>(null)
  const [editingGroup, setEditingGroup] = useState<{ group?: Group } | null>(null)
  const [moving, setMoving] = useState<Category | null>(null)
  const list = categories.filter((c) => c.type === type)
  const groups = allGroups.filter((g) => g.type === type)
  const groupIds = new Set(groups.map((g) => g.id))
  const sections: { group?: Group; items: Category[] }[] = [
    ...groups.map((group) => ({ group, items: list.filter((c) => c.groupId === group.id) })),
    { items: list.filter((c) => !c.groupId || !groupIds.has(c.groupId)) },
  ]

  /** Swaps the position with the neighbour in the same section */
  const shift = async (items: Category[], index: number, delta: number) => {
    const other = items[index + delta]
    if (!other) return
    const current = items[index]
    await db.transaction('rw', db.categories, async () => {
      await db.categories.update(current.id, { order: other.order })
      await db.categories.update(other.id, { order: current.order })
    })
  }

  const shiftGroup = async (index: number, delta: number) => {
    const other = groups[index + delta]
    if (!other) return
    const current = groups[index]
    await db.transaction('rw', db.groups, async () => {
      await db.groups.update(current.id, { order: other.order })
      await db.groups.update(other.id, { order: current.order })
    })
  }

  const remove = async (category: Category) => {
    setEditing(null)
    if (list.length === 1) {
      alert({ title: 'Nicht möglich', message: 'Jede Eintragsart braucht mindestens eine Kategorie.', buttons: [{ label: 'OK', style: 'strong' }] })
      return
    }
    const entries = await db.entries.where('categoryId').equals(category.id).count()
    const standing = await db.recurring.where('categoryId').equals(category.id).count()
    if (entries === 0 && standing === 0) {
      alert({
        title: `„${category.name}“ löschen?`,
        buttons: [
          { label: 'Löschen', style: 'destructive', onClick: () => db.categories.delete(category.id) },
          { label: 'Abbrechen', style: 'strong' },
        ],
      })
      return
    }
    const parts = [entries > 0 && `${entries} ${entries === 1 ? 'Eintrag' : 'Einträge'}`, standing > 0 && `${standing} ${standing === 1 ? 'Dauerauftrag oder Abo' : 'Daueraufträge oder Abos'}`].filter(Boolean)
    alert({
      title: `„${category.name}“ löschen?`,
      message: `Zu dieser Kategorie gehören ${parts.join(' und ')}. Was soll damit passieren?`,
      buttons: [
        { label: 'In andere Kategorie verschieben', onClick: () => setMoving(category) },
        {
          label: 'Mit löschen',
          style: 'destructive',
          onClick: async () => {
            await db.transaction('rw', db.entries, db.recurring, db.categories, async () => {
              await db.entries.where('categoryId').equals(category.id).delete()
              await db.recurring.where('categoryId').equals(category.id).delete()
              await db.categories.delete(category.id)
            })
            toast(`„${category.name}“ gelöscht`)
          },
        },
        { label: 'Abbrechen', style: 'strong' },
      ],
    })
  }

  return (
    <SubPage title="Kategorien" onBack={onBack}>
      <Segmented value={type} options={TYPE_OPTIONS} onChange={setType} />
      {sections.map(({ group, items }, sectionIndex) => (
        <section key={group?.id ?? 'none'}>
          <div className="group-title">
            {group
              ? (
                <>
                  <button className="group-name" onClick={() => setEditingGroup({ group })}>
                    <span className="dot" style={{ background: group.color }} />
                    <span>{group.name}</span>
                    <span className="tint" style={{ fontSize: 13, fontWeight: 400 }}>Bearbeiten</span>
                  </button>
                  <button className="icon-btn tint" aria-label={`${group.name} nach oben`} disabled={sectionIndex === 0} onClick={() => shiftGroup(sectionIndex, -1)}><Icon name="up" size={18} /></button>
                  <button className="icon-btn tint" aria-label={`${group.name} nach unten`} disabled={sectionIndex === groups.length - 1} onClick={() => shiftGroup(sectionIndex, 1)}><Icon name="down" size={18} /></button>
                </>
              )
              : items.length > 0 && <span className="group-name plain">Ohne Überkategorie</span>}
          </div>
          {items.length > 0 && (
            <div className="group">
              {items.map((c, index) => (
                <div key={c.id} className="row" style={{ paddingRight: 4 }}>
                  <button style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', gap: 12, textAlign: 'left' }} onClick={() => setEditing({ category: c })}>
                    <CategoryIcon category={c} />
                    <span className="row-main row-title">{c.name}</span>
                  </button>
                  <button className="icon-btn tint" aria-label={`${c.name} nach oben`} disabled={index === 0} onClick={() => shift(items, index, -1)}><Icon name="up" size={20} /></button>
                  <button className="icon-btn tint" aria-label={`${c.name} nach unten`} disabled={index === items.length - 1} onClick={() => shift(items, index, 1)}><Icon name="down" size={20} /></button>
                </div>
              ))}
            </div>
          )}
          {group && items.length === 0 && <p className="section-foot" style={{ marginTop: 0 }}>Noch leer. Ordne in einer Kategorie diese Überkategorie zu.</p>}
        </section>
      ))}
      <div className="group" style={{ marginTop: 24 }}>
        <button className="row tint" onClick={() => setEditing({})}><Icon name="plus" size={20} /> Neue Kategorie</button>
        <button className="row tint" onClick={() => setEditingGroup({})}><Icon name="plus" size={20} /> Neue Überkategorie</button>
      </div>
      <p className="section-foot">Zum Verschieben in eine andere Überkategorie tippe auf die Kategorie. Überkategorien fassen Kategorien im Ring-Diagramm und in der Auswertung zusammen.</p>
      {editing && <CategorySheet category={editing.category} type={type} groups={groups} onClose={() => setEditing(null)} onDelete={() => remove(editing.category!)} />}
      {editingGroup && <GroupSheet group={editingGroup.group} type={type} onClose={() => setEditingGroup(null)} />}
      {moving && <MoveSheet category={moving} targets={list.filter((c) => c.id !== moving.id)} onClose={() => setMoving(null)} />}
    </SubPage>
  )
}
