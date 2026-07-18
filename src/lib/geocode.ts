export interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
  timezone: string
}

export interface GeocodeCandidate {
  placeId: string
  formattedAddress: string
  lat: number
  lng: number
}

export type GeocodeResponse =
  | { status: 'ok'; result: GeocodeResult }
  | { status: 'ambiguous'; candidates: GeocodeCandidate[] }

export class AddressSelectionCancelledError extends Error {}

export async function fetchGeocode(address: string): Promise<GeocodeResponse> {
  return postGeocode({ address })
}

export async function fetchGeocodeByPlaceId(placeId: string): Promise<GeocodeResult> {
  const response = await postGeocode({ placeId })
  // A place_id lookup always resolves to exactly one place — never ambiguous.
  return (response as { status: 'ok'; result: GeocodeResult }).result
}

async function postGeocode(body: { address: string } | { placeId: string }): Promise<GeocodeResponse> {
  const response = await fetch('/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new Error(errorBody?.error ?? 'Failed to geocode address')
  }

  return response.json()
}

/**
 * Resolves free-text address input to coordinates. When the Geocoding API can't
 * confidently pick a single match, `requestPick` is used to let the user choose
 * from the candidates instead of silently guessing or failing.
 */
export async function resolveAddress(
  address: string,
  requestPick: (candidates: GeocodeCandidate[]) => Promise<GeocodeCandidate | null>,
): Promise<GeocodeResult | null> {
  const trimmed = address.trim()
  if (!trimmed) return null

  const response = await fetchGeocode(trimmed)
  if (response.status === 'ok') return response.result

  const chosen = await requestPick(response.candidates)
  if (!chosen) throw new AddressSelectionCancelledError()

  return fetchGeocodeByPlaceId(chosen.placeId)
}
