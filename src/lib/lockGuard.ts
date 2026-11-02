/**
 * The system camera, photo picker and share sheet send the page to the background.
 * That must not lock the app, otherwise a half-filled form would be hidden behind the lock.
 * The exception only holds right after the dialog was requested, so it cannot skip a later lock.
 */
const WINDOW_MS = 3000
let requestedAt = 0

export const expectSystemDialog = () => { requestedAt = Date.now() }

export function takeSystemDialog(): boolean {
  const expected = Date.now() - requestedAt < WINDOW_MS
  requestedAt = 0
  return expected
}
