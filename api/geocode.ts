// Server-side only — calls Google Geocoding API + Time Zone API with the
// secret GOOGLE_MAPS_API_KEY. Never call these APIs from src/.
// Timezone is resolved at geocoding time, same key/ecosystem (see Decision Log).
// See ./README.md.

interface GeocodeRequestBody {
  address?: string
  placeId?: string
}

interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
  timezone: string
  city: string | null
}

interface AddressComponent {
  long_name: string
  types: string[]
}

// Priority-ordered, type-driven — never a per-country lookup (see CLAUDE.md's
// country-agnostic principle). `locality` covers most places; `postal_town` is
// Google's stand-in for it in the UK/Japan; the admin-area levels are the closest
// fallback for locations without a locality (rural addresses, small islands, etc.).
const CITY_COMPONENT_TYPES = [
  'locality',
  'postal_town',
  'administrative_area_level_2',
  'administrative_area_level_1',
]

function extractCity(components: AddressComponent[] | undefined): string | null {
  if (!Array.isArray(components)) return null
  for (const type of CITY_COMPONENT_TYPES) {
    const match = components.find((component) => component.types?.includes(type))
    if (match) return match.long_name
  }
  return null
}

interface GeocodeCandidate {
  placeId: string
  formattedAddress: string
  lat: number
  lng: number
}

type GeocodeResponse =
  | { status: 'ok'; result: GeocodeResult }
  | { status: 'ambiguous'; candidates: GeocodeCandidate[] }

const GEOCODE_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const TIMEZONE_API_URL = 'https://maps.googleapis.com/maps/api/timezone/json'
const MAX_CANDIDATES = 5

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('geocode: GOOGLE_MAPS_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: GeocodeRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const placeId = body.placeId?.trim()
  if (placeId) {
    return resolvePlaceId(placeId, apiKey)
  }

  const address = body.address?.trim()
  if (!address) {
    return jsonResponse({ error: 'address or placeId is required' }, 400)
  }

  const geocodeUrl = new URL(GEOCODE_API_URL)
  geocodeUrl.searchParams.set('address', address)
  geocodeUrl.searchParams.set('key', apiKey)

  const geocodeResponse = await fetch(geocodeUrl)
  if (!geocodeResponse.ok) {
    console.error('geocode: Geocoding API HTTP error', geocodeResponse.status, await geocodeResponse.text())
    return jsonResponse({ error: 'Failed to geocode address' }, 502)
  }

  const geocodeData = await geocodeResponse.json()
  if (geocodeData.status === 'ZERO_RESULTS') {
    return jsonResponse({ error: 'Address not found' }, 404)
  }
  if (geocodeData.status !== 'OK') {
    console.error('geocode: Geocoding API status error', geocodeData.status, geocodeData.error_message)
    return jsonResponse({ error: 'Failed to geocode address' }, 502)
  }

  const results = geocodeData.results
  if (!Array.isArray(results) || results.length === 0) {
    return jsonResponse({ error: 'Address not found' }, 404)
  }

  if (results.length > 1) {
    const candidates: GeocodeCandidate[] = results
      .slice(0, MAX_CANDIDATES)
      .filter((candidate) => candidate?.place_id && candidate?.geometry?.location)
      .map((candidate) => ({
        placeId: candidate.place_id,
        formattedAddress: candidate.formatted_address ?? address,
        lat: candidate.geometry.location.lat,
        lng: candidate.geometry.location.lng,
      }))
    if (candidates.length > 1) {
      const payload: GeocodeResponse = { status: 'ambiguous', candidates }
      return jsonResponse(payload)
    }
  }

  const result = results[0]
  const location = result?.geometry?.location
  if (!result || !location) {
    return jsonResponse({ error: 'Address not found' }, 404)
  }

  const timezone = await fetchTimezone(location.lat, location.lng, apiKey)
  if (!timezone) {
    return jsonResponse({ error: 'Failed to resolve timezone for this location' }, 502)
  }

  const payload: GeocodeResponse = {
    status: 'ok',
    result: {
      lat: location.lat,
      lng: location.lng,
      formattedAddress: result.formatted_address ?? address,
      timezone,
      city: extractCity(result.address_components),
    },
  }
  return jsonResponse(payload)
}

async function resolvePlaceId(placeId: string, apiKey: string): Promise<Response> {
  const geocodeUrl = new URL(GEOCODE_API_URL)
  geocodeUrl.searchParams.set('place_id', placeId)
  geocodeUrl.searchParams.set('key', apiKey)

  const geocodeResponse = await fetch(geocodeUrl)
  if (!geocodeResponse.ok) {
    console.error('geocode: Geocoding API HTTP error', geocodeResponse.status, await geocodeResponse.text())
    return jsonResponse({ error: 'Failed to geocode address' }, 502)
  }

  const geocodeData = await geocodeResponse.json()
  if (geocodeData.status !== 'OK') {
    console.error('geocode: Geocoding API status error', geocodeData.status, geocodeData.error_message)
    return jsonResponse({ error: 'Failed to geocode address' }, 502)
  }

  const result = geocodeData.results?.[0]
  const location = result?.geometry?.location
  if (!result || !location) {
    return jsonResponse({ error: 'Address not found' }, 404)
  }

  const timezone = await fetchTimezone(location.lat, location.lng, apiKey)
  if (!timezone) {
    return jsonResponse({ error: 'Failed to resolve timezone for this location' }, 502)
  }

  const payload: GeocodeResponse = {
    status: 'ok',
    result: {
      lat: location.lat,
      lng: location.lng,
      formattedAddress: result.formatted_address ?? '',
      timezone,
      city: extractCity(result.address_components),
    },
  }
  return jsonResponse(payload)
}

async function fetchTimezone(lat: number, lng: number, apiKey: string): Promise<string | null> {
  const timezoneUrl = new URL(TIMEZONE_API_URL)
  timezoneUrl.searchParams.set('location', `${lat},${lng}`)
  timezoneUrl.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)))
  timezoneUrl.searchParams.set('key', apiKey)

  const response = await fetch(timezoneUrl)
  if (!response.ok) {
    console.error('geocode: Time Zone API HTTP error', response.status, await response.text())
    return null
  }

  const data = await response.json()
  if (data.status !== 'OK' || typeof data.timeZoneId !== 'string') {
    console.error('geocode: Time Zone API status error', data.status, data.errorMessage)
    return null
  }

  return data.timeZoneId
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
