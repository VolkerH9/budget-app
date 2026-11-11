import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Paperclip, Tag } from 'lucide-react'
import { db, getMeta, newId, PARENTS_EXPENSE, type Category, type Entry, type EntryType } from '../db'
import { useApp, useCategories, useLabels } from '../context'
import { formatDate, today } from '../lib/dates'
import { amountToInput, parseAmount } from '../lib/format'
import { haptic } from '../lib/haptics'
import { expectSystemDialog } from '../lib/lockGuard'
import { autoLabels, chosenLabels } from '../lib/labels'
import { compressPhoto } from '../lib/photos'
import { prepareImage, scanReceipt, ScanError, type ScanResult } from '../lib/scan'
import { deletePhotos, savePhotos, whenSaved } from '../lib/vault'
import { Icon } from './Icon'
import { LabelChip, LabelPicker } from './Labels'
import { PhotoThumb, PhotoViewer, type PhotoSource } from './PhotoViewer'
import { AmountDisplay, Keypad } from './Keypad'
import { Segmented, Sheet, Switch } from './ui'
import { CategoryIcon } from './CategoryIcon'

export const TYPE_OPTIONS: [EntryType, string][] = [['expense', 'Ausgabe'], ['saving', 'Sparen'], ['income', 'Einnahme']]

/** Categories of one type, most recently used first. */
export function useSortedCategories(type: EntryType): Category[] {
  const categories = useCategories()
  const recent = useLiveQuery(async () => {
    const latest = await db.entries.orderBy('date').reverse().limit(200).toArray()
    return latest.filter((e) => !e.recurringId).sort((a, b) => b.createdAt - a.createdAt).map((e) => e.categoryId)
  }, [], [] as string[])
  return useMemo(() => {
    const rank = (c: Category) => {
      const index = recent.indexOf(c.id)
      return index === -1 ? recent.length + c.order : index
    }
    return categories.filter((c) => c.type === type).sort((a, b) => rank(a) - rank(b))
  }, [categories, recent, type])
}

/** Receipt photos of the entry: add from camera or library, view, replace, delete. */
function PhotoRow({ photos, onChange, busy }: { photos: PhotoSource[]; onChange: (photos: PhotoSource[]) => void; busy: boolean }) {
  const { alert } = useApp()
  const [viewing, setViewing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const replacing = useRef<number | null>(null)
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)

  const choose = (replace: number | null) => {
    replacing.current = replace
    alert({
      title: replace === null ? 'Beleg anhängen' : 'Foto ersetzen',
      buttons: [
        { label: 'Foto aufnehmen', onClick: () => { expectSystemDialog(); camera.current?.click() } },
        { label: 'Aus Mediathek wählen', onClick: () => { expectSystemDialog(); library.current?.click() } },
        { label: 'Abbrechen', style: 'strong' },
      ],
    })
  }

  const onFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])]
    if (camera.current) camera.current.value = ''
    if (library.current) library.current.value = ''
    if (list.length === 0) return
    setAdding(true)
    try {
      const added: PhotoSource[] = []
      for (const file of list) added.push({ id: newId(), blob: await compressPhoto(file) })
      const at = replacing.current
      onChange(at === null ? [...photos, ...added] : photos.map((p, i) => (i === at ? added[0] : p)))
    } catch {
      alert({ title: 'Foto nicht lesbar', message: 'Bitte versuche ein anderes Foto.', buttons: [{ label: 'OK', style: 'strong' }] })
    } finally {
      setAdding(false)
    }
  }

  const remove = (index: number) => alert({
    title: 'Foto löschen?',
    message: 'Das Foto wird beim Sichern des Eintrags entfernt.',
    buttons: [
      { label: 'Löschen', style: 'destructive', onClick: () => onChange(photos.filter((_, i) => i !== index)) },
      { label: 'Abbrechen', style: 'strong' },
    ],
  })

  return (
    <>
      {photos.length > 0 && (
        <div className="photo-strip" role="group" aria-label="Belegfotos">
          {photos.map((p, i) => (
            <button key={p.id} className="photo-pick" aria-label={`Belegfoto ${i + 1} ansehen`} onClick={() => setViewing(i)}>
              <PhotoThumb source={p} />
            </button>
          ))}
        </div>
      )}
      <button className="field grow center scan-btn" disabled={busy || adding} onClick={() => choose(null)}>
        <Paperclip size={19} strokeWidth={1.9} aria-hidden="true" /> {adding ? 'Wird verkleinert …' : photos.length > 0 ? 'Weiteres Foto' : 'Foto anhängen'}
      </button>
      {viewing !== null && (
        <PhotoViewer
          photos={photos}
          start={viewing}
          onClose={() => setViewing(null)}
          onReplace={(i) => { setViewing(null); choose(i) }}
          onDelete={(i) => { setViewing(null); remove(i) }}
        />
      )}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={library} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </>
  )
}

export function EntrySheet({ entry, draft, onClose, onSaved }: { entry?: Entry; draft?: Partial<Entry>; onClose: () => void; onSaved?: (entry: Entry, before?: Entry) => void }) {
  const { toast, alert, openAfford } = useApp()
  const start = entry ?? draft
  const [type, setType] = useState<EntryType>(start?.type ?? 'expense')
  const [amount, setAmount] = useState(start?.amount ? amountToInput(start.amount) : '')
  const [categoryId, setCategoryId] = useState(start?.categoryId ?? '')
  const [date, setDate] = useState(start?.date ?? today())
  const [note, setNote] = useState(start?.note ?? '')
  const [merchant, setMerchant] = useState(entry?.merchant ?? '')
  const thumbnail = entry?.thumbnail
  const [refunded, setRefunded] = useState(entry?.refunded ?? false)
  const [forParents, setForParents] = useState(entry?.forParents ?? false)
  const allLabels = useLabels()
  // New entries get the labels whose period contains their date; taking one off counts for this entry only
  const [added, setAdded] = useState<string[]>(start?.labels ?? [])
  const [removed, setRemoved] = useState<string[]>([])
  const [pickingLabels, setPickingLabels] = useState(false)
  const auto = entry ? [] : autoLabels(allLabels, date)
  const labels = chosenLabels(auto, added, removed)
  const toggleLabel = (id: string) => {
    if (labels.includes(id)) {
      setAdded(added.filter((x) => x !== id))
      if (auto.includes(id)) setRemoved([...removed, id])
    } else {
      setRemoved(removed.filter((x) => x !== id))
      if (!auto.includes(id)) setAdded([...added, id])
    }
  }
  // Labels shown as chips: the chosen ones and those active on the date that were taken off
  const shownLabels = allLabels.filter((l) => labels.includes(l.id) || auto.includes(l.id))
  const parentsExpense = type === 'expense' && (categoryId === PARENTS_EXPENSE || forParents)
  const [photos, setPhotos] = useState<PhotoSource[]>(() => (entry?.photos ?? []).map((id) => ({ id })))
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const categories = useSortedCategories(type)

  const cents = parseAmount(amount)
  const valid = cents !== null && categories.some((c) => c.id === categoryId)

  const changeType = (next: EntryType) => {
    setType(next)
    setCategoryId('')
  }

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    const values = {
      type,
      amount: cents,
      categoryId,
      date,
      note: note.trim() || undefined,
      merchant: merchant.trim() || undefined,
      thumbnail,
      refunded: parentsExpense && refunded ? true : undefined,
      forParents: type === 'expense' && categoryId !== PARENTS_EXPENSE && forParents ? true : undefined,
      labels: labels.length > 0 ? labels : undefined,
      photos: photos.length > 0 ? photos.map((p) => p.id) : undefined,
    }
    try {
      // Photos first, so the entry never points to a photo that is not stored
      await savePhotos(photos.filter((p) => p.blob).map((p) => ({ id: p.id, data: p.blob! })))
      const saved: Entry = entry ? { ...entry, ...values } : { ...values, id: newId(), createdAt: Date.now() }
      await db.entries.put(saved)
      const removed = (entry?.photos ?? []).filter((id) => !photos.some((p) => p.id === id))
      if (removed.length > 0) whenSaved().then(() => deletePhotos(removed)).catch((error) => console.error(error))
      haptic()
      toast(entry ? 'Änderung gespeichert' : 'Eintrag gespeichert')
      onClose()
      onSaved?.(saved, entry)
    } catch (error) {
      console.error(error)
      setSaving(false)
      alert({ title: 'Speichern fehlgeschlagen', message: 'Ist der Speicher des iPhones voll? Bitte versuche es noch einmal.', buttons: [{ label: 'OK', style: 'strong' }] })
    }
  }

  const applyScan = (result: ScanResult) => {
    if (result.amount) setAmount(amountToInput(result.amount))
    if (result.merchant) setMerchant(result.merchant)
    if (result.date) setDate(result.date)
    if (result.categoryId) setCategoryId(result.categoryId)
    setScanned(true)
  }

  const chooseSource = async () => {
    const apiKey = await getMeta('apiKey', '')
    if (!apiKey) {
      alert({
        title: 'API-Schlüssel fehlt',
        message: 'Trage zuerst deinen Claude-API-Schlüssel ein: Einstellungen › Belegscan.',
        buttons: [{ label: 'OK', style: 'strong' }],
      })
      return
    }
    alert({
      title: 'Beleg scannen',
      buttons: [
        { label: 'Foto aufnehmen', onClick: () => { expectSystemDialog(); camera.current?.click() } },
        { label: 'Aus Mediathek wählen', onClick: () => { expectSystemDialog(); library.current?.click() } },
        { label: 'Abbrechen', style: 'strong' },
      ],
    })
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setScanning(true)
    try {
      const { base64 } = await prepareImage(file)
      // The scanned receipt is kept as a photo of the entry, removable before saving
      const kept = (await getMeta('saveThumbnails', true)) ? await compressPhoto(file).catch(() => null) : null
      if (kept) setPhotos((list) => [...list, { id: newId(), blob: kept }])
      const result = await scanReceipt(base64, await getMeta('apiKey', ''), categories)
      applyScan(result)
    } catch (error) {
      alert({
        title: 'Scan nicht möglich',
        message: error instanceof ScanError ? error.message : 'Bitte versuche es noch einmal.',
        buttons: [{ label: 'OK', style: 'strong' }],
      })
    } finally {
      setScanning(false)
      if (camera.current) camera.current.value = ''
      if (library.current) library.current.value = ''
    }
  }

  return (
    <Sheet
      title={entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}
      onClose={onClose}
      full
      action={{ label: 'Sichern', onClick: save, disabled: !valid }}
    >
      <Segmented value={type} options={TYPE_OPTIONS} onChange={changeType} />
      {!entry && type === 'expense' && (
        <button className="afford-link" onClick={() => openAfford({ amount: cents ?? undefined, categoryId: categoryId || undefined, name: note.trim() || undefined })}>
          Kann ich mir das leisten?
        </button>
      )}
      <AmountDisplay text={amount} />

      <div className="cat-strip" role="group" aria-label="Kategorie">
        {categories.map((c) => (
          <button key={c.id} className="cat-pick" aria-pressed={c.id === categoryId} onClick={() => setCategoryId(c.id)}>
            <CategoryIcon category={c} size={32} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>

      {(scanning || scanned) && (
        <div className="preview" role="status">
          <span>{scanning ? 'Beleg wird gelesen …' : 'Vorausgefüllt. Bitte prüfen und sichern.'}</span>
        </div>
      )}

      <div className="form-row">
        <label className="field" style={{ flex: 'none' }}>
          <Icon name="calendar" size={18} />
          <span className="num">{date === today() ? 'Heute' : formatDate(date)}</span>
          <input type="date" aria-label="Datum" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="field grow">
          <input type="text" placeholder="Notiz (optional)" aria-label="Notiz" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="label-row" role="group" aria-label="Labels">
        {shownLabels.map((l) => <LabelChip key={l.id} label={l} pressed={labels.includes(l.id)} crossed={!labels.includes(l.id)} onClick={() => { haptic(); toggleLabel(l.id) }} />)}
        <button type="button" className="label-chip add" onClick={() => setPickingLabels(true)}><Tag size={14} strokeWidth={2} aria-hidden="true" /> {shownLabels.length > 0 ? 'Labels' : 'Label'}</button>
      </div>

      {type === 'expense' && categoryId !== PARENTS_EXPENSE && categoryId !== '' && (
        <div className="form-row">
          <div className="field grow">
            <span style={{ flex: 1, color: 'var(--label)' }}>Eltern-Kosten</span>
            <Switch label="Eltern-Kosten" checked={forParents} onChange={setForParents} />
          </div>
        </div>
      )}

      {parentsExpense && (
        <div className="form-row">
          <div className="field grow">
            <span style={{ flex: 1, color: 'var(--label)' }}>Von Eltern erstattet</span>
            <Switch label="Von Eltern erstattet" checked={refunded} onChange={setRefunded} />
          </div>
        </div>
      )}
      {pickingLabels && <LabelPicker selected={labels} onToggle={toggleLabel} onClose={() => setPickingLabels(false)} />}

      {(merchant || scanned) && (
        <div className="form-row">
          <label className="field grow">
            <input type="text" placeholder="Händler" aria-label="Händler" value={merchant} maxLength={80} onChange={(e) => setMerchant(e.target.value)} />
          </label>
        </div>
      )}

      <div className="form-row photo-row">
        {type === 'expense' && (
          <button className="field grow center scan-btn" disabled={scanning} onClick={chooseSource}>
            <Icon name="camera" size={20} /> Beleg scannen
          </button>
        )}
        <PhotoRow photos={photos} onChange={setPhotos} busy={scanning} />
      </div>

      <Keypad onChange={setAmount} />

      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={library} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </Sheet>
  )
}
