import { supabase } from './supabase'

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

export type PlaceSearchBias = { lat: number; lng: number } | { regionCode: string } | null

export class PlaceSearchFailedError extends Error {}

// TABI-49: rich Google Places search for the Activities menu's Add flow — distinct
// from the plain address-autocomplete (PlaceAutocompleteField), which never surfaces
// rating/photo/category metadata.
export async function searchPlaces(query: string, bias: PlaceSearchBias): Promise<PlaceSearchResult[]> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  const response = await fetch('/api/places-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, ...(bias ?? {}) }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new PlaceSearchFailedError(errorBody?.error ?? 'Failed to search places')
  }

  const responseBody = await response.json()
  if (responseBody.status !== 'ok') {
    throw new PlaceSearchFailedError(responseBody.error ?? 'Place search failed')
  }

  return responseBody.results as PlaceSearchResult[]
}

export function placePhotoUrl(photoRef: string, width = 400): string {
  return `/api/places-photo?ref=${encodeURIComponent(photoRef)}&w=${width}`
}

export interface NearbyPlacesOptions {
  /** TABI-135: 'tourist' scopes results to restaurant/bar/cafe/tourist_attraction/museum. */
  mode?: 'default' | 'tourist'
  /** Meters; server clamps this independently, so an out-of-range value here is only advisory. */
  radius?: number
}

// TABI-24: nearby-places map on the free-block "+ Add" — same auth/response shape as
// searchPlaces above, but centered on a point instead of a typed query. TABI-135 reuses
// this same endpoint/quota for the "Show tourist places" map overlay via `options.mode`.
export async function searchNearbyPlaces(
  lat: number,
  lng: number,
  options?: NearbyPlacesOptions,
): Promise<PlaceSearchResult[]> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  const response = await fetch('/api/places-nearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ lat, lng, ...options }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new PlaceSearchFailedError(errorBody?.error ?? 'Failed to search nearby places')
  }

  const responseBody = await response.json()
  if (responseBody.status !== 'ok') {
    throw new PlaceSearchFailedError(responseBody.error ?? 'Nearby place search failed')
  }

  return responseBody.results as PlaceSearchResult[]
}
