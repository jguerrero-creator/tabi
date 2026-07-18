// Server-side only — calls Google Routes API (computeRoutes) with the
// secret GOOGLE_MAPS_API_KEY. Never call Routes API from src/.
// See ./README.md.

interface LatLng {
  lat: number
  lng: number
}

type TravelMode = 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT' | 'TRAIN'

interface TravelTimeRequestBody {
  origin: LatLng
  destination: LatLng
  mode?: TravelMode
  departureTime?: string
}

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('travel-time: GOOGLE_MAPS_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: TravelTimeRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { origin, destination, mode = 'DRIVE', departureTime } = body
  if (!isLatLng(origin) || !isLatLng(destination)) {
    return jsonResponse({ error: 'origin and destination must be { lat, lng }' }, 400)
  }

  // TRAIN isn't a Routes API travelMode on its own — it's TRANSIT narrowed to
  // rail via transitPreferences, so the "train" spec requirement stays distinct
  // from general public transit.
  const isTrain = mode === 'TRAIN'

  const routesResponse = await fetch(ROUTES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { location: { latLng: toGoogleLatLng(origin) } },
      destination: { location: { latLng: toGoogleLatLng(destination) } },
      travelMode: isTrain ? 'TRANSIT' : mode,
      ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE' } : {}),
      ...(isTrain ? { transitPreferences: { allowedTravelModes: ['TRAIN'] } } : {}),
      ...(departureTime ? { departureTime } : {}),
    }),
  })

  if (!routesResponse.ok) {
    console.error('travel-time: Routes API error', routesResponse.status, await routesResponse.text())
    return jsonResponse({ error: 'Failed to compute travel time' }, 502)
  }

  const data = await routesResponse.json()
  const route = data.routes?.[0]
  if (!route) {
    return jsonResponse({ error: 'No route found' }, 404)
  }

  return jsonResponse({
    durationSeconds: parseDurationSeconds(route.duration),
    distanceMeters: route.distanceMeters ?? null,
  })
}

function toGoogleLatLng(value: LatLng): { latitude: number; longitude: number } {
  return { latitude: value.lat, longitude: value.lng }
}

function isLatLng(value: unknown): value is LatLng {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LatLng).lat === 'number' &&
    typeof (value as LatLng).lng === 'number'
  )
}

function parseDurationSeconds(duration: string | undefined): number | null {
  const match = duration ? /^(\d+)s$/.exec(duration) : null
  return match ? Number(match[1]) : null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
