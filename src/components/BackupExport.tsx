import { useState } from 'react'
import { useApp, useAskToShare } from '../context'
import { backupName, createBackupFile, markBackupDone, saveFile } from '../lib/backup'

const fileSize = (length: number) => length < 1_000_000
  ? `${Math.max(1, Math.round(length / 1000))} KB`
  : `${(length / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`

/** Creates the encrypted backup with all photos and opens the share sheet. */
export function useBackupExport(): { run: () => Promise<void>; busy: boolean } {
  const { toast, alert } = useApp()
  const askToShare = useAskToShare()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const { text, photos } = await createBackupFile()
      const shared = await saveFile(backupName('json'), text, 'application/json', askToShare)
      if (!shared) return
      await markBackupDone()
      toast(`Backup gesichert: ${fileSize(text.length)}${photos > 0 ? `, ${photos} ${photos === 1 ? 'Foto' : 'Fotos'}` : ''}`)
    } catch (error) {
      alert({ title: 'Backup nicht möglich', message: (error as Error).message, buttons: [{ label: 'OK', style: 'strong' }] })
    } finally {
      setBusy(false)
    }
  }
  return { run, busy }
}
