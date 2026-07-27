// TABI-184: single shared "Saved" confirmation, callable from any save handler
// (reservation, trip, note, planned location, reminder, etc.) without each
// screen rebuilding its own toast. Plain module-level pub/sub — mirrors the
// app's existing lack of a global state library rather than introducing one.
type ToastListener = (message: string) => void

const listeners = new Set<ToastListener>()

export function showSavedToast(message: string) {
  for (const listener of listeners) listener(message)
}

export function subscribeToSavedToast(listener: ToastListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
