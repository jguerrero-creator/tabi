// Server-side half of the central entitlement check (TABI-98). Any /api
// handler that needs to gate an action (e.g. an AI call) should call
// `requireEntitlement` first and bail out on a denied result — never compare
// `plan` itself. Shares the same plan -> features/limits config and
// checkEntitlement() logic as the client side, so the two can never disagree.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkEntitlement, type EntitlementCheck, type Plan } from '../../src/lib/entitlements.js'
import type { Database } from '../../src/types/database.types'

export type EntitlementResult =
  | { allowed: true }
  | { allowed: false; reason: 'unauthenticated' | 'denied' | 'misconfigured' }

// Resolves the caller's plan from the Supabase session they sent (the
// Authorization header, forwarded as-is) and runs checkEntitlement() against
// it. RLS restricts the `profiles` read to the caller's own row, so this
// only ever needs the (non-secret) anon key, never a service-role key.
export async function requireEntitlement(
  request: Request,
  check: EntitlementCheck,
): Promise<EntitlementResult> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) {
    return { allowed: false, reason: 'unauthenticated' }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('entitlements: Supabase env vars are not configured')
    return { allowed: false, reason: 'misconfigured' }
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return { allowed: false, reason: 'unauthenticated' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userData.user.id)
    .single()

  if (profileError || !profile) {
    return { allowed: false, reason: 'denied' }
  }

  return checkEntitlement(profile.plan as Plan, check)
    ? { allowed: true }
    : { allowed: false, reason: 'denied' }
}

// Service-role variant for server-to-server callers with no user session or
// Authorization header at all — the inbound-email webhook (api/inbound-email.ts)
// resolves a trip from which dedicated address the mail was sent to, not from a
// logged-in caller, so requireEntitlement()'s header-based flow doesn't apply. Same
// checkEntitlement()/plan source of truth as the client-key path above, just a
// different (already-known) organizer id instead of one resolved from a JWT.
export async function requireEntitlementForOrganizer(
  serviceClient: SupabaseClient<Database>,
  organizerId: string,
  check: EntitlementCheck,
): Promise<EntitlementResult> {
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('plan')
    .eq('id', organizerId)
    .single()

  if (profileError || !profile) {
    return { allowed: false, reason: 'denied' }
  }

  return checkEntitlement(profile.plan as Plan, check)
    ? { allowed: true }
    : { allowed: false, reason: 'denied' }
}
