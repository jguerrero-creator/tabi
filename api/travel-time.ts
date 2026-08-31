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

export const config = { runtime: 'edge' }

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
  const isTransit = mode === 'TRANSIT' || isTrain

  // TABI-88: transit-only step data (travelMode + stop names), needed to detect a
  // same-station transfer — skipped for non-transit modes, which have no steps to check.
  const fieldMask = isTransit
    ? 'routes.duration,routes.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.transitDetails.stopDetails.arrivalStop.name,routes.legs.steps.transitDetails.stopDetails.departureStop.name'
    : 'routes.duration,routes.distanceMeters'

  const routesResponse = await fetch(ROUTES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
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
  // No route isn't a request failure — it's a legitimate "unusable" result (e.g. Transit
  // coverage gaps in some regions/Google Cloud projects, confirmed against Google's own
  // developer forum). Same "unknown, not zero" null-duration convention callers already
  // handle for a malformed route below, rather than a distinct error path per mode/region.
  if (!route) {
    return jsonResponse({ durationSeconds: null, distanceMeters: null, hasDirectTransfer: false })
  }

  return jsonResponse({
    durationSeconds: parseDurationSeconds(route.duration),
    distanceMeters: route.distanceMeters ?? null,
    hasDirectTransfer: isTransit ? hasDirectTransfer(route) : false,
  })
}

interface RouteLegStep {
  travelMode?: string
  transitDetails?: {
    stopDetails?: {
      arrivalStop?: { name?: string }
      departureStop?: { name?: string }
    }
  }
}

// TABI-88: a "direct transfer" is two consecutive TRANSIT steps (no WALK step between
// them in the raw, ordered steps list — adjacency in that list is itself proof nothing
// was interposed) whose station names match, i.e. the rider changes vehicle without
// leaving the station. Never inferred/guessed — only ever derived from real Routes API
// stop names, per the "AI never invents facts" principle (this path has no AI involved
// at all, but the same real-data-only bar applies).
function hasDirectTransfer(route: { legs?: { steps?: RouteLegStep[] }[] }): boolean {
  const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? [])
  for (let i = 0; i < steps.length - 1; i++) {
    const current = steps[i]
    const next = steps[i + 1]
    if (current.travelMode !== 'TRANSIT' || next.travelMode !== 'TRANSIT') continue

    const arrivalName = current.transitDetails?.stopDetails?.arrivalStop?.name
    const departureName = next.transitDetails?.stopDetails?.departureStop?.name
    if (arrivalName && departureName && normalizeStationName(arrivalName) === normalizeStationName(departureName)) {
      return true
    }
  }
  return false
}

// Loose match: case/whitespace/punctuation-insensitive, and strips generic
// "station" wording so e.g. "Shinjuku Station" and "Shinjuku Sta." both match "shinjuku".
function normalizeStationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\bstation\b|\bsta\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
