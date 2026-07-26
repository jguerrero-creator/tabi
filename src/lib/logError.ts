// TABI-bugfix: catch blocks across the app fall back to a generic user-facing message,
// but were discarding the real Supabase/network error entirely. Logged here so the
// underlying code/message survives for investigation, with an offline hint since that's
// the one failure mode a user can act on themselves without more detail.
export function logClientError(context: string, err: unknown): void {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  console.error(`[${context}]${offline ? ' (offline)' : ''}`, err)
}
