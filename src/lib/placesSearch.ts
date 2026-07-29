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
