import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { logClientError } from './logError'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// PGRST303 ("JWT issued at future") comes from clock drift between Supabase's own
// Auth and PostgREST/Postgres nodes, not our code or the device clock — the skew is
// seconds-scale and self-resolves, so one delayed retry lets real time catch up to
// the token's iat before we give up. Scoped to this client's fetch so it covers every
// Supabase call (auth, postgrest, storage) from one place.
async function fetchWithClockSkewRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status !== 401) return response

  const body = await response
    .clone()
    .json()
    .catch(() => null)
  if (body?.code !== 'PGRST303') return response

  logClientError('supabase.fetchWithClockSkewRetry', body)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  return fetch(input, init)
}

// TABI-44: must be read synchronously here, at module load, before createClient()
// below gets a chance to run any async work. createClient()'s constructor kicks off
// GoTrueClient's own initialize() immediately (fire-and-forget, not awaited) to detect
// a session from this same URL hash — and if it finds a `type=recovery` redirect, it
// fires the PASSWORD_RECOVERY event via a bare `setTimeout(..., 0)`, not synchronously.
// Meanwhile main.tsx gates the whole React render behind ensureAnonSession(), whose
// getSession() call awaits that *same* internal init promise — so the render (and thus
// App.tsx's onAuthStateChange subscription) can unblock and run before that setTimeout's
// macrotask ever fires. Confirmed directly in the installed @supabase/auth-js source
// (GoTrueClient.js), not assumed: this is a genuine race, not a hypothetical one.
// Reading the hash ourselves, synchronously, sidesteps it entirely — nothing here can
// run later than this line, since nothing has yielded to the event loop yet.
export const isPasswordRecoveryRedirect =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type') === 'recovery'

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithClockSkewRetry },
})

export async function ensureAnonSession() {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session

  const { data: signInData, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  return signInData.session
}
