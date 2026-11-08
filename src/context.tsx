import { createContext, useContext } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category, type Entry, type Group } from './db'
import type { AlertButton } from './components/ui'
import type { AskToShare } from './lib/backup'

export interface AlertRequest {
  title: string
  message?: string
  buttons: AlertButton[]
}

export type SettingsPage = 'categories' | 'recurring' | 'subscriptions' | 'security' | 'scan' | 'design'

export interface AppContext {
  month: string
  setMonth: (month: string) => void
  /** Opens the entry form, empty or for an existing entry */
  openEntry: (entry?: Entry) => void
  /** Removes the entry and offers Rückgängig */
  deleteEntry: (entry: Entry) => void
  toast: (text: string, onUndo?: () => void) => void
  alert: (request: AlertRequest) => void
  /** Switches to the settings tab, optionally straight to one of its pages */
  openSettings: (page?: SettingsPage) => void
  /** Page the settings tab should show once, then cleared */
  settingsPage: SettingsPage | null
  clearSettingsPage: () => void
  /** Opens "Monatsabrechnung als PDF", optionally for a month and variant */
  openReport: (options?: { month?: string; kind?: 'parents' | 'month' }) => void
}

export const Ctx = createContext<AppContext>(null as unknown as AppContext)
export const useApp = () => useContext(Ctx)

/** Second tap for the share sheet, for files that took a while to prepare */
export function useAskToShare(): AskToShare {
  const { alert } = useApp()
  return (share, cancel) => alert({
    title: 'Datei ist fertig',
    message: 'Tippe auf „Teilen“, um sie zu sichern oder zu senden.',
    buttons: [{ label: 'Teilen', style: 'strong', onClick: share }, { label: 'Abbrechen', onClick: cancel }],
  })
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), [], [] as Category[])
}

export function useGroups(): Group[] {
  return useLiveQuery(() => db.groups.orderBy('order').toArray(), [], [] as Group[])
}

export function useMeta<T>(key: string, fallback: T): T {
  return useLiveQuery(async () => (await db.meta.get(key))?.value as T | undefined, [key]) ?? fallback
}

/** Entries from `from` to `to`, both included */
export function useRangeEntries(from: string, to: string): Entry[] {
  return useLiveQuery(() => db.entries.where('date').between(from, to, true, true).toArray(), [from, to], [] as Entry[])
}
