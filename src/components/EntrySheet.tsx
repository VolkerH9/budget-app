import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getMeta, newId, type Category, type Entry, type EntryType } from '../db'
import { useApp, useCategories } from '../context'
import { formatDate, today } from '../lib/dates'
import { amountToInput, parseAmount } from '../lib/format'
import { expectSystemDialog } from '../lib/lockGuard'
import { prepareImage, scanReceipt, ScanError, type ScanResult } from '../lib/scan'
import { Icon } from './Icon'
import { AmountDisplay, Keypad } from './Keypad'
import { Segmented, Sheet } from './ui'

export const TYPE_OPTIONS: [EntryType, string][] = [['expense', 'Ausgabe'], ['saving', 'Sparen'], ['income', 'Einnahme']]

/** Categories of one type, most recently used first. */
function useSortedCategories(type: EntryType): Category[] {
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

export function EntrySheet({ entry, onClose }: { entry?: Entry; onClose: () => void }) {
  const { toast, alert } = useApp()
  const [type, setType] = useState<EntryType>(entry?.type ?? 'expense')
  const [amount, setAmount] = useState(entry ? amountToInput(entry.amount) : '')
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? '')
  const [date, setDate] = useState(entry?.date ?? today())
  const [note, setNote] = useState(entry?.note ?? '')
  const [merchant, setMerchant] = useState(entry?.merchant ?? '')
  const [thumbnail, setThumbnail] = useState(entry?.thumbnail)
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
    if (!valid) return
    const values = {
      type,
      amount: cents,
      categoryId,
      date,
      note: note.trim() || undefined,
      merchant: merchant.trim() || undefined,
      thumbnail,
    }
    if (entry) await db.entries.update(entry.id, values)
    else await db.entries.add({ ...values, id: newId(), createdAt: Date.now() })
    toast(entry ? 'Änderung gespeichert' : 'Eintrag gespeichert')
    onClose()
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
      const { base64, thumbnail: small } = await prepareImage(file)
      const result = await scanReceipt(base64, await getMeta('apiKey', ''), categories)
      applyScan(result)
      if (await getMeta('saveThumbnails', true)) setThumbnail(small)
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
      <AmountDisplay text={amount} />

      <div className="cat-strip" role="group" aria-label="Kategorie">
        {categories.map((c) => (
          <button key={c.id} className="cat-pick" aria-pressed={c.id === categoryId} onClick={() => setCategoryId(c.id)}>
            <span style={{ fontSize: 24, lineHeight: '30px' }} aria-hidden="true">{c.emoji}</span>
            <span>{c.name}</span>
          </button>
        ))}
      </div>

      {(scanning || scanned) && (
        <div className="preview" role="status">
          {thumbnail && <img src={thumbnail} alt="" />}
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

      {(merchant || scanned) && (
        <div className="form-row">
          <label className="field grow">
            <input type="text" placeholder="Händler" aria-label="Händler" value={merchant} maxLength={80} onChange={(e) => setMerchant(e.target.value)} />
          </label>
        </div>
      )}

      {type === 'expense' && (
        <div className="form-row">
          <button className="field grow center scan-btn" disabled={scanning} onClick={chooseSource}>
            <Icon name="camera" size={20} /> Beleg scannen
          </button>
        </div>
      )}

      <Keypad onChange={setAmount} />

      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <input ref={library} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </Sheet>
  )
}
