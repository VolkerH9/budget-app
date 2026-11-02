import { createContext, useContext } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category, type Entry } from './db'
import type { AlertButton } from './components/ui'

export interface AlertRequest {
  title: string
  message?: string
  buttons: AlertButton[]
}

export interface AppContext {
  month: string
  setMonth: (month: string) => void
  /** Opens the entry form, empty or for an existing entry */
  openEntry: (entry?: Entry) => void
  /** Removes the entry and offers Rückgängig */
  deleteEntry: (entry: Entry) => void
  toast: (text: string, onUndo?: () => void) => void
  alert: (request: AlertRequest) => void
}

export const Ctx = createContext<AppContext>(null as unknown as AppContext)
export const useApp = () => useContext(Ctx)

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), [], [] as Category[])
}

export function useMeta<T>(key: string, fallback: T): T {
  return useLiveQuery(async () => (await db.meta.get(key))?.value as T | undefined, [key]) ?? fallback
}
