// Server-side only — calls the Places API (New) Place Details endpoint with the
// secret GOOGLE_MAPS_API_KEY. Never call this API from src/. See ./README.md.
//
// TABI-89: regular opening hours aren't returned by Text/Nearby Search (see
// places-search.ts, places-nearby.ts), so a dedicated Place Details GET is needed
// once per place-attach selection. Real Google data only — no AI/generative
// fallback (Decision Log, 2026-07-16): a missing regularOpeningHours field means
// "no data", never "closed".
import { checkRateLimit } from './_lib/rateLimit.js'
import { GooglePlaceDetailsSchema, PLACE_DETAILS_OPENING_HOURS_FIELD_MASK, type RegularOpeningHours } from './_lib/googlePlaces.js'

interface PlaceOpeningHoursRequestBody {
  placeId?: string
}

type PlaceOpeningHoursResponse = { status: 'ok'; regularOpeningHours: RegularOpeningHours | null }

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('place-opening-hours: GOOGLE_MAPS_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const rateLimit = await checkRateLimit(request, 'place-opening-hours')
  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily lookup limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: PlaceOpeningHoursRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const placeId = body.placeId?.trim()
  if (!placeId) {
    return jsonResponse({ error: 'placeId is required' }, 400)
  }

  let googleResponse: Response
  try {
    googleResponse = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACE_DETAILS_OPENING_HOURS_FIELD_MASK,
      },
    })
  } catch (error) {
    console.error('place-opening-hours: Place Details API request failed', error)
    return jsonResponse({ error: 'Failed to fetch place details' }, 502)
  }

  if (!googleResponse.ok) {
    console.error('place-opening-hours: Place Details API HTTP error', googleResponse.status, await googleResponse.text())
    return jsonResponse({ error: 'Failed to fetch place details' }, 502)
  }

  const rawData = await googleResponse.json()
  const parsed = GooglePlaceDetailsSchema.safeParse(rawData)
  if (!parsed.success) {
    console.error('place-opening-hours: Place Details API response failed schema validation', parsed.error)
    return jsonResponse({ error: 'Failed to fetch place details' }, 502)
  }

  return jsonResponse<PlaceOpeningHoursResponse>({
    status: 'ok',
    regularOpeningHours: parsed.data.regularOpeningHours ?? null,
  })
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
