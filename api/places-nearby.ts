// Server-side only — calls the Places API (New) Nearby Search endpoint with the
// secret GOOGLE_MAPS_API_KEY. Never call this API from src/. See ./README.md.
//
// TABI-24: powers the free-block "+ Add" nearby-places map — unlike places-search.ts's
// Text Search (a user-typed query), this takes only a center point and returns whatever
// is around it. Shares its response schema/mapping with places-search.ts via
// ./_lib/googlePlaces.ts since both call the same underlying `places[]` shape.
import { checkRateLimit } from './_lib/rateLimit.js'
import { GoogleSearchResponseSchema, mapGooglePlaces, PLACE_FIELD_MASK, type PlaceSearchResult } from './_lib/googlePlaces.js'

interface PlacesNearbyRequestBody {
  lat?: number
  lng?: number
}

type PlacesNearbyResponse = { status: 'ok'; results: PlaceSearchResult[] }

const MAX_RESULTS = 15
const RADIUS_METERS = 1500
// Suggestions here are "things to do" for a free block, not lodging — TABI-24 spec.
// A static exclusion, not per-country logic (CLAUDE.md #3).
const EXCLUDED_TYPES = ['lodging']

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('places-nearby: GOOGLE_MAPS_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const rateLimit = await checkRateLimit(request, 'places-nearby')
  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily search limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: PlacesNearbyRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return jsonResponse({ error: 'lat and lng are required' }, 400)
  }

  const requestBody = {
    locationRestriction: {
      circle: { center: { latitude: body.lat, longitude: body.lng }, radius: RADIUS_METERS },
    },
    maxResultCount: MAX_RESULTS,
    rankPreference: 'POPULARITY',
    excludedTypes: EXCLUDED_TYPES,
  }

  let googleResponse: Response
  try {
    googleResponse = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACE_FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    console.error('places-nearby: Nearby Search API request failed', error)
    return jsonResponse({ error: 'Failed to search nearby places' }, 502)
  }

  if (!googleResponse.ok) {
    console.error('places-nearby: Nearby Search API HTTP error', googleResponse.status, await googleResponse.text())
    return jsonResponse({ error: 'Failed to search nearby places' }, 502)
  }

  const rawData = await googleResponse.json()
  const parsed = GoogleSearchResponseSchema.safeParse(rawData)
  if (!parsed.success) {
    console.error('places-nearby: Nearby Search API response failed schema validation', parsed.error)
    return jsonResponse({ error: 'Failed to search nearby places' }, 502)
  }

  const results = mapGooglePlaces(parsed.data.places, 'Nearby place')

  return jsonResponse<PlacesNearbyResponse>({ status: 'ok', results })
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
