// Server-side only — calls the Places API (New) Nearby Search endpoint with the
// secret GOOGLE_MAPS_API_KEY. Never call this API from src/. See ./README.md.
//
// TABI-24: powers the free-block "+ Add" nearby-places map — unlike places-search.ts's
// Text Search (a user-typed query), this takes only a center point and returns curated
// "things to do" types around it (see CURATED_PLACE_TYPES below). Shares its response
// schema/mapping with places-search.ts via ./_lib/googlePlaces.ts since both call the
// same underlying `places[]` shape.
import { checkRateLimit } from './_lib/rateLimit.js'
import { GoogleSearchResponseSchema, mapGooglePlaces, PLACE_FIELD_MASK, type PlaceSearchResult } from './_lib/googlePlaces.js'

interface PlacesNearbyRequestBody {
  lat?: number
  lng?: number
  // TABI-135: 'tourist' powers the opt-in "Show tourist places" map overlay, scoped to
  // the viewport via a caller-supplied radius; omitted/'default' is the TABI-24
  // free-block "+ Add" suggestions. Both modes share the same CURATED_PLACE_TYPES
  // allow-list — they differ only in radius bounds and result count.
  mode?: 'default' | 'tourist'
  radius?: number
}

type PlacesNearbyResponse = { status: 'ok'; results: PlaceSearchResult[] }

const MAX_RESULTS = 15
const RADIUS_METERS = 1500

// TABI-135: fixed server-side allow-list — a client-supplied `mode: 'tourist'` never
// lets arbitrary Google place types through, only these five. TABI-24's default "+ Add"
// suggestions used to only exclude lodging, letting an unrestricted POPULARITY-ranked
// Nearby Search return whatever Google considered popular nearby — including place
// types (transit stops, administrative points, etc.) that aren't really "things to do"
// for a free block, and that are also disproportionately likely to lack a Google
// displayName (see googlePlaces.ts's dropped-if-unnamed handling). Both modes now share
// this same curated list rather than default mode having its own broader, unrestricted one.
//
// Matched via `includedPrimaryTypes`, not `includedTypes`: Google's Nearby Search
// matches `includedTypes` against a place's *entire* `types[]` array, so a hotel with
// "restaurant"/"bar"/"cafe" among its secondary types (most hotels have at least one)
// would still pass an `includedTypes` filter — reintroducing exactly the lodging results
// this list is meant to keep out. `includedPrimaryTypes` matches only the place's single
// `primaryType`, so a hotel (primaryType "hotel") is excluded regardless of its amenities.
const CURATED_PLACE_TYPES = ['restaurant', 'bar', 'cafe', 'tourist_attraction', 'museum']
const TOURIST_MAX_RESULTS = 20
const TOURIST_MIN_RADIUS_METERS = 200
const TOURIST_MAX_RADIUS_METERS = 3000

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

  const isTourist = body.mode === 'tourist'
  const requestedRadius = Number.isFinite(body.radius) ? (body.radius as number) : RADIUS_METERS
  const radius = isTourist ? clamp(requestedRadius, TOURIST_MIN_RADIUS_METERS, TOURIST_MAX_RADIUS_METERS) : RADIUS_METERS

  const requestBody = {
    locationRestriction: {
      circle: { center: { latitude: body.lat, longitude: body.lng }, radius },
    },
    maxResultCount: isTourist ? TOURIST_MAX_RESULTS : MAX_RESULTS,
    rankPreference: 'POPULARITY',
    includedPrimaryTypes: CURATED_PLACE_TYPES,
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

  const results = mapGooglePlaces(parsed.data.places)

  return jsonResponse<PlacesNearbyResponse>({ status: 'ok', results })
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
