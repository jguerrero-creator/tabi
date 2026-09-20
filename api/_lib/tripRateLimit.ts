// Trip-keyed counterpart to ./rateLimit.ts, for callers with no authenticated user at
// all — the inbound-email webhook (api/inbound-email.ts) identifies a caller only by
// which trip's dedicated address the mail was sent to, not by an Authorization header,
// so the per-user auth.uid()-based RPC (increment_api_call_counter) doesn't apply.
// Mirrors that pattern exactly, just keyed by trip_id via a service-role client instead
// of by user_id via the anon-key + RLS path: public.trip_api_call_quotas,
// incremented atomically via increment_trip_api_call_counter().
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database.types'

// Deliberately conservative — a real per-trip volume of forwarded confirmations is
// low (a handful per trip), so this is mainly an abuse/cost backstop once the
// address pattern is guessable, not a limit a genuine user should ever hit.
const TRIP_DAILY_LIMITS = {
  'inbound-email': 10,
} as const

export type TripRateLimitedEndpoint = keyof typeof TRIP_DAILY_LIMITS

export type TripRateLimitResult = { allowed: true } | { allowed: false; reason: 'exceeded' | 'misconfigured' }

export async function checkTripRateLimit(
  serviceClient: SupabaseClient<Database>,
  tripId: string,
  endpoint: TripRateLimitedEndpoint,
): Promise<TripRateLimitResult> {
  const { data: count, error } = await serviceClient.rpc('increment_trip_api_call_counter', {
    p_trip_id: tripId,
    p_endpoint: endpoint,
  })
  if (error || typeof count !== 'number') {
    console.error('tripRateLimit: failed to increment call counter', error)
    return { allowed: false, reason: 'misconfigured' }
  }

  return count <= TRIP_DAILY_LIMITS[endpoint] ? { allowed: true } : { allowed: false, reason: 'exceeded' }
}
