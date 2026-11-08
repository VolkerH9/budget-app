import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context'
import { openBackupFile, parseBackup, readSealed, restoreBackup, type Backup, type Photo } from '../lib/backup'
import { bookDueEntries } from '../lib/booking'
import { Sheet } from './ui'

type SealedFile = NonNullable<ReturnType<typeof readSealed>>

const dateOf = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Reads a chosen backup file. Encrypted files first ask for the access code they were made with. */
export function BackupImport({ file, onClose }: { file: File; onClose: () => void }) {
  const { alert, toast } = useApp()
  const [sealed, setSealed] = useState<SealedFile | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const read = useRef(false)

  const fail = (e: unknown) => {
    alert({ title: 'Das hat nicht geklappt', message: (e as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })
    onClose()
  }

  const confirm = (backup: Backup, photos: Photo[]) => {
    onClose()
    const pictures = photos.length > 0 ? ` und ${photos.length} ${photos.length === 1 ? 'Foto' : 'Fotos'}` : ''
    alert({
      title: 'Backup einspielen?',
      message: `${backup.entries.length} Einträge${pictures} vom ${dateOf(backup.exportedAt)}. Alle aktuellen Einträge, Fotos, Kategorien, Daueraufträge und Abos werden ersetzt.`,
      buttons: [
        { label: 'Ersetzen', style: 'destructive', onClick: () => { restoreBackup(backup, photos).then(() => bookDueEntries()).then(() => toast('Backup eingespielt')).catch(fail) } },
        { label: 'Abbrechen', style: 'strong' },
      ],
    })
  }

  useEffect(() => {
    if (read.current) return
    read.current = true
    file.text().then((text) => {
      const found = readSealed(text)
      if (found) setSealed(found)
      else confirm(parseBackup(text), [])
    }).catch(fail)
  })

  const open = async () => {
    if (!sealed || busy) return
    setBusy(true)
    setError('')
    try {
      const { backup, photos } = await openBackupFile(sealed, code)
      confirm(backup, photos)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (!sealed) return null
  return (
    <Sheet title="Backup öffnen" onClose={onClose} action={{ label: 'Öffnen', onClick: open, disabled: code.length === 0 || busy }}>
      <p className="sheet-question">Backup vom {dateOf(sealed.exportedAt)}</p>
      <form onSubmit={(e) => { e.preventDefault(); open() }}>
        <div className="group">
          <label className="row">
            <input className="left" type="password" autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              placeholder="App-Code" aria-label="App-Code des Backups" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
        </div>
      </form>
      <p className="section-foot" role="status">{busy ? 'Wird entschlüsselt …' : error || 'Gib den App-Code ein, der beim Erstellen des Backups galt.'}</p>
      <div style={{ height: 16 }} />
    </Sheet>
  )
}
