import { useSyncExternalStore } from 'react'

export type Theme = 'standard' | 'hud'

const KEY = 'budget-theme'
const listeners = new Set<() => void>()

/** The design is no secret, so it lives outside the encrypted data and applies to the lock screen too. */
function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'hud' ? 'hud' : 'standard'
  } catch {
    return 'standard'
  }
}

let current = read()

export function applyTheme(): void {
  document.documentElement.dataset.theme = current
  document.querySelector('meta[name="theme-color"][data-hud]')?.remove()
  if (current === 'hud') {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#03070b'
    meta.dataset.hud = ''
    document.head.prepend(meta)
  }
}

export function setTheme(theme: Theme): void {
  current = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private mode: the choice lasts until the app closes
  }
  applyTheme()
  listeners.forEach((listener) => listener())
}

export function useTheme(): Theme {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => current)
}
