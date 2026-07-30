// Server-side only — resolves who a trip organizer's daily recap should go
// to. See ../send-daily-recap.ts.
//
// Tabi has no email-capture flow yet (TABI-36 follow-up ticket): auth is
// anonymous-only (`supabase.auth.signInAnonymously()`), and `profiles` has no
// email column. There is currently no real recipient to resolve for any
// user — this always returns null in production. `RECAP_TEST_RECIPIENT` is a
// dev-only override so the Resend integration itself can be verified
// end-to-end (a real email actually arriving) without waiting on that flow.
//
// This is the single seam the follow-up ticket flips: once `profiles` gets a
// real email column, this function reads it, and nothing else in the
// pipeline (recapContent.ts, recapEmail.ts, send-daily-recap.ts) changes.
export function resolveRecapRecipient(_organizerId: string): string | null {
  return process.env.RECAP_TEST_RECIPIENT ?? null
}
