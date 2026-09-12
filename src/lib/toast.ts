// TABI-184: single shared "Saved" confirmation, callable from any save handler
// (reservation, trip, note, planned location, reminder, etc.) without each
// screen rebuilding its own toast. Plain module-level pub/sub — mirrors the
// app's existing lack of a global state library rather than introducing one.
export type ToastVariant = 'success' | 'error'
type ToastListener = (message: string, variant: ToastVariant) => void

const listeners = new Set<ToastListener>()

export function showSavedToast(message: string) {
  for (const listener of listeners) listener(message, 'success')
}

/** Same shared toast, red/error styled — e.g. a rejected Planning drag-and-drop move (TABI-195). */
export function showErrorToast(message: string) {
  for (const listener of listeners) listener(message, 'error')
}

export function subscribeToSavedToast(listener: ToastListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
