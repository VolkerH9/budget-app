import { useState } from 'react'
import { db, newId, type Category, type EntryType } from '../db'
import { useApp, useCategories } from '../context'
import { Icon } from '../components/Icon'
import { TYPE_OPTIONS } from '../components/EntrySheet'
import { CategoryIcon, Segmented, Sheet } from '../components/ui'
import { SubPage } from './Settings'

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#a4703a', '#5b6b82', '#8e8e93', '#0e9aa7']
const EMOJIS = ['🛒', '🍽️', '☕️', '🍕', '🍺', '🧴', '💊', '🛍️', '👕', '👟', '🏃', '⚽️', '🎬', '🎮', '🎵', '🎁', '✈️', '🏖️', '🚗', '🚲', '🚆', '⛽️', '🏠', '💡', '📱', '💻', '🎓', '📚', '📺', '🐶', '👶', '❤️', '📦', '💰', '📈', '💼', '🏦', '🎉', '🔧', '🌱', '👪', '👵']

function CategorySheet({ category, type, onClose, onDelete }: {
  category?: Category
  type: EntryType
  onClose: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [emoji, setEmoji] = useState(category?.emoji ?? '📦')
  const [color, setColor] = useState(category?.color ?? COLORS[0])

  const save = async () => {
    const values = { name: name.trim(), emoji: emoji.trim() || '📦', color }
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
          <CategoryIcon emoji={emoji} color={color} />
          <input className="left" type="text" placeholder="Name" aria-label="Name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <h3 className="section-title">Farbe</h3>
      <div className="group swatches">
        {COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Farbe ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} />)}
      </div>
      <h3 className="section-title">Emoji</h3>
      <div className="group">
        <div className="row">
          <span className="row-main">Eigenes Emoji</span>
          <input type="text" aria-label="Eigenes Emoji" style={{ flex: '0 0 60px' }} value={emoji} onChange={(e) => setEmoji([...e.target.value].slice(-2).join(''))} />
        </div>
        <div className="emoji-grid">
          {EMOJIS.map((e) => <button key={e} aria-pressed={e === emoji} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
      </div>
      {category && <button className="row center danger" style={{ marginTop: 24, borderRadius: 12 }} onClick={onDelete}>Kategorie löschen</button>}
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
            <CategoryIcon emoji={c.emoji} color={c.color} />
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
  const [type, setType] = useState<EntryType>('expense')
  const [editing, setEditing] = useState<{ category?: Category } | null>(null)
  const [moving, setMoving] = useState<Category | null>(null)
  const list = categories.filter((c) => c.type === type)

  const shift = async (index: number, delta: number) => {
    const other = list[index + delta]
    if (!other) return
    const current = list[index]
    await db.transaction('rw', db.categories, async () => {
      await db.categories.update(current.id, { order: other.order })
      await db.categories.update(other.id, { order: current.order })
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
    const parts = [entries > 0 && `${entries} ${entries === 1 ? 'Eintrag' : 'Einträge'}`, standing > 0 && `${standing} ${standing === 1 ? 'Dauerauftrag' : 'Daueraufträge'}`].filter(Boolean)
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
      <div className="group" style={{ marginTop: 12 }}>
        {list.map((c, index) => (
          <div key={c.id} className="row" style={{ paddingRight: 4 }}>
            <button style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', gap: 12, textAlign: 'left' }} onClick={() => setEditing({ category: c })}>
              <CategoryIcon emoji={c.emoji} color={c.color} />
              <span className="row-main row-title">{c.name}</span>
            </button>
            <button className="icon-btn tint" aria-label={`${c.name} nach oben`} disabled={index === 0} onClick={() => shift(index, -1)}><Icon name="up" size={20} /></button>
            <button className="icon-btn tint" aria-label={`${c.name} nach unten`} disabled={index === list.length - 1} onClick={() => shift(index, 1)}><Icon name="down" size={20} /></button>
          </div>
        ))}
        <button className="row tint" onClick={() => setEditing({})}><Icon name="plus" size={20} /> Neue Kategorie</button>
      </div>
      {editing && <CategorySheet category={editing.category} type={type} onClose={() => setEditing(null)} onDelete={() => remove(editing.category!)} />}
      {moving && <MoveSheet category={moving} targets={list.filter((c) => c.id !== moving.id)} onClose={() => setMoving(null)} />}
    </SubPage>
  )
}
