// Server-side only — calls the Places API (New) Text Search endpoint with the
// secret GOOGLE_MAPS_API_KEY. Never call this API from src/. See ./README.md.
//
// TABI-49: rich place search for the Activities menu's Add flow, distinct from
// the plain address-autocomplete already used on every address field (see
// Decision Log "Autocomplete Google Places sur tous les champs adresse,
// distinct de la recherche riche Activités (V1)"). Text Search (New) already
// returns rating/review-count/photos/primaryType at this field mask, so no
// separate Place Details call is made here.
import { z } from 'zod'
import { checkRateLimit } from './_lib/rateLimit.js'

interface PlacesSearchRequestBody {
  query?: string
  lat?: number
  lng?: number
  regionCode?: string
}

export interface PlaceSearchResult {
  googlePlaceId: string
  name: string
  formattedAddress: string
  lat: number
  lng: number
  rating: number | null
  userRatingsTotal: number | null
  photoRef: string | null
  category: string | null
}

type PlacesSearchResponse = { status: 'ok'; results: PlaceSearchResult[] }

// Validated before mapping — Google's response is external data, never trusted blindly.
const GooglePlaceSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  rating: z.number().nullable().optional(),
  userRatingCount: z.number().nullable().optional(),
  photos: z.array(z.object({ name: z.string() })).optional(),
  primaryType: z.string().nullable().optional(),
})
const GoogleSearchResponseSchema = z.object({ places: z.array(GooglePlaceSchema).optional() })

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.photos',
  'places.primaryType',
].join(',')

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
        'X-Goog-FieldMask': FIELD_MASK,
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

  const results: PlaceSearchResult[] = (parsed.data.places ?? [])
    .filter((place) => place.location)
    .map((place) => ({
      googlePlaceId: place.id,
      name: place.displayName?.text ?? query,
      formattedAddress: place.formattedAddress ?? '',
      lat: place.location!.latitude,
      lng: place.location!.longitude,
      rating: place.rating ?? null,
      userRatingsTotal: place.userRatingCount ?? null,
      photoRef: place.photos?.[0]?.name ?? null,
      category: place.primaryType ?? null,
    }))

  return jsonResponse<PlacesSearchResponse>({ status: 'ok', results })
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
