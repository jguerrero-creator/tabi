// Server-side only — calls the Claude API directly via fetch (see ./extract-reservation.ts for
// why not @anthropic-ai/sdk) with the secret ANTHROPIC_API_KEY to pull a LIST of decided
// day-locations/reservations out of a pasted travel plan or exported planning conversation
// (TABI-208). Never call the Claude API from src/. See ./README.md.
//
// The actual Claude call/schema/tool is its own pipeline in ./_lib/extraction.ts
// (runPlanExtraction) — a genuinely different output shape (a list, two item kinds) from the
// single-reservation pipeline, but built on the same shared low-level Claude-call helper so the
// fetch/error-handling/validation logic isn't duplicated.
//
// The model never sees the trip's real dates — it only recognizes date-like text and, when a
// date's year isn't stated, emits ISO 8601's year-omitted form (`--MM-DD`, see PLAN_SYSTEM_PROMPT).
// Year resolution against the trip's actual start/end dates (a real fact, not a guess from prose)
// happens here, deterministically, via resolveYearlessDates — never inside the LLM call.
import { createClient } from '@supabase/supabase-js'
import { requireEntitlement } from './_lib/entitlements.js'
import type { ContentBlockParam } from './_lib/extraction.js'
import { resolveYearlessDates, runPlanExtraction, type ExtractPlanResult } from './_lib/extraction.js'
import { checkRateLimit } from './_lib/rateLimit.js'
import type { Database } from '../src/types/database.types.js'

interface ExtractPlanRequestBody {
  kind?: 'text'
  text?: string
  tripId?: string
}

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('extract-plan: ANTHROPIC_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const entitlement = await requireEntitlement(request, { feature: 'aiAccess' })
  if (!entitlement.allowed) {
    if (entitlement.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (entitlement.reason === 'denied') {
      return jsonResponse({ error: 'Your plan does not include AI import' }, 403)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const rateLimit = await checkRateLimit(request, 'extract-plan')
  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily extraction limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: ExtractPlanRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const text = body.text?.trim()
  if (!text) {
    return jsonResponse({ error: 'text is required' }, 400)
  }
  const tripId = body.tripId?.trim()
  if (!tripId) {
    return jsonResponse({ error: 'tripId is required' }, 400)
  }

  const contentBlock: ContentBlockParam = { type: 'text', text }
  const result = await runPlanExtraction(contentBlock, 'Extract this travel plan.', apiKey, 'extract-plan')

  if (result.status === 'ok') {
    const tripDates = await fetchTripDateRange(request, tripId)
    const resolved = resolveYearlessDates(result.result, tripDates?.startDate ?? null, tripDates?.endDate ?? null)
    return jsonResponse<ExtractPlanResult>({ status: 'ok', result: resolved })
  }

  return jsonResponse<ExtractPlanResult>(result)
}

// RLS-scoped to the caller's own Authorization header (same pattern as _lib/entitlements.ts and
// _lib/rateLimit.ts) — never a service-role key. Returns null on any failure (missing auth,
// misconfiguration, trip not found/not the caller's) rather than throwing, so a lookup problem
// degrades to "resolve nothing" instead of failing the whole extraction.
async function fetchTripDateRange(
  request: Request,
  tripId: string,
): Promise<{ startDate: string | null; endDate: string | null } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return null

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('extract-plan: Supabase env vars are not configured')
    return null
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data, error } = await supabase.from('trips').select('start_date, end_date').eq('id', tripId).single()
  if (error || !data) {
    console.error('extract-plan: failed to fetch trip date range', error)
    return null
  }
  return { startDate: data.start_date, endDate: data.end_date }
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
