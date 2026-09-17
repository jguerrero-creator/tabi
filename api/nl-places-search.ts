// Server-side only — translates a traveler's free-text search request into structured Google
// Places filters via Claude (TABI-79). This endpoint NEVER calls Google itself and NEVER
// returns a place — see ./_lib/placesFilterExtraction.ts for why. The client feeds the
// returned filters into the existing /api/places-search endpoint (searchPlaces in
// src/lib/placesSearch.ts), exactly like a manually-typed search — there is no second
// Places-calling code path here.
import { requireEntitlement } from './_lib/entitlements.js'
import { runPlacesFilterExtraction } from './_lib/placesFilterExtraction.js'
import type { PlacesFilterResult } from './_lib/placesFilterExtraction.js'
import { checkRateLimit } from './_lib/rateLimit.js'

interface NlPlacesSearchRequestBody {
  query?: string
}

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('nl-places-search: ANTHROPIC_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const [entitlement, rateLimit] = await Promise.all([
    requireEntitlement(request, { feature: 'aiAccess' }),
    checkRateLimit(request, 'nl-places-search'),
  ])

  if (!entitlement.allowed) {
    if (entitlement.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (entitlement.reason === 'denied') {
      return jsonResponse({ error: 'Your plan does not include AI search' }, 403)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily search limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: NlPlacesSearchRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const query = body.query?.trim()
  if (!query) {
    return jsonResponse({ error: 'query is required' }, 400)
  }

  const result = await runPlacesFilterExtraction(query, apiKey, 'nl-places-search')
  return jsonResponse<PlacesFilterResult>(result)
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
