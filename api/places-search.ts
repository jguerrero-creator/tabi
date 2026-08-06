// Server-side only — calls the Places API (New) Text Search endpoint with the
// secret GOOGLE_MAPS_API_KEY. Never call this API from src/. See ./README.md.
//
// TABI-49: rich place search for the Activities menu's Add flow, distinct from
// the plain address-autocomplete already used on every address field (see
// Decision Log "Autocomplete Google Places sur tous les champs adresse,
// distinct de la recherche riche Activités (V1)"). Text Search (New) already
// returns rating/review-count/photos/primaryType at this field mask, so no
// separate Place Details call is made here.
import { checkRateLimit } from './_lib/rateLimit.js'
import { GoogleSearchResponseSchema, mapGooglePlaces, PLACE_FIELD_MASK, type PlaceSearchResult } from './_lib/googlePlaces.js'

interface PlacesSearchRequestBody {
  query?: string
  lat?: number
  lng?: number
  regionCode?: string
}

export type { PlaceSearchResult }

type PlacesSearchResponse = { status: 'ok'; results: PlaceSearchResult[] }

const MAX_RESULTS = 8
const BIAS_RADIUS_METERS = 15000

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('places-search: GOOGLE_MAPS_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const rateLimit = await checkRateLimit(request, 'places-search')
  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily search limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: PlacesSearchRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const query = body.query?.trim()
  if (!query) {
    return jsonResponse({ error: 'query is required' }, 400)
  }

  const requestBody: Record<string, unknown> = { textQuery: query, maxResultCount: MAX_RESULTS }
  if (typeof body.lat === 'number' && typeof body.lng === 'number') {
    requestBody.locationBias = {
      circle: { center: { latitude: body.lat, longitude: body.lng }, radius: BIAS_RADIUS_METERS },
    }
  } else if (body.regionCode) {
    requestBody.regionCode = body.regionCode
  }

  let googleResponse: Response
  try {
    googleResponse = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACE_FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    console.error('places-search: Text Search API request failed', error)
    return jsonResponse({ error: 'Failed to search places' }, 502)
  }

  if (!googleResponse.ok) {
    console.error('places-search: Text Search API HTTP error', googleResponse.status, await googleResponse.text())
    return jsonResponse({ error: 'Failed to search places' }, 502)
  }

  const rawData = await googleResponse.json()
  const parsed = GoogleSearchResponseSchema.safeParse(rawData)
  if (!parsed.success) {
    console.error('places-search: Text Search API response failed schema validation', parsed.error)
    return jsonResponse({ error: 'Failed to search places' }, 502)
  }

  const results = mapGooglePlaces(parsed.data.places, query)

  return jsonResponse<PlacesSearchResponse>({ status: 'ok', results })
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
