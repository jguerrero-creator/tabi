// Server-side per-user daily quota on costly external API calls (TABI-96),
// so a bug or abusive usage can't run up the bill unnoticed. Counts are kept
// in Supabase (public.api_call_quotas), incremented atomically via the
// increment_api_call_counter() RPC — durable across edge/serverless
// invocations, unlike an in-memory counter. Mirrors the caller-resolution
// pattern in ./entitlements.ts (same Authorization header, same anon-key +
// RLS approach) but limit numbers live here in code, not in the DB, so
// raising a limit never needs a migration.
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database.types'

// Endpoint name -> max calls per user per day.
const DAILY_LIMITS = {
  'extract-reservation': 20,
  'import-url': 20,
  'extract-plan': 10,
  'places-search': 50,
  'places-nearby': 50,
} as const

export type RateLimitedEndpoint = keyof typeof DAILY_LIMITS

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: 'unauthenticated' | 'exceeded' | 'misconfigured' }

export async function checkRateLimit(request: Request, endpoint: RateLimitedEndpoint): Promise<RateLimitResult> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) {
    return { allowed: false, reason: 'unauthenticated' }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('rateLimit: Supabase env vars are not configured')
    return { allowed: false, reason: 'misconfigured' }
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: count, error } = await supabase.rpc('increment_api_call_counter', { p_endpoint: endpoint })
  if (error || typeof count !== 'number') {
    console.error('rateLimit: failed to increment call counter', error)
    return { allowed: false, reason: 'misconfigured' }
  }

  return count <= DAILY_LIMITS[endpoint] ? { allowed: true } : { allowed: false, reason: 'exceeded' }
}
