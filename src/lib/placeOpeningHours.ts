import { supabase } from './supabase'

export interface RegularOpeningHours {
  periods: Array<{
    open: { day: number; hour: number; minute: number }
    close?: { day: number; hour: number; minute: number }
  }>
}

export class PlaceOpeningHoursFailedError extends Error {}

// TABI-89: fetched once per place-attach selection (ActivityPlaceSearchModal,
// NearbyPlacesMapModal) alongside the existing geocode call, then cached on the
// reservation's place_opening_hours column — never re-fetched on every view.
export async function fetchPlaceOpeningHours(placeId: string): Promise<RegularOpeningHours | null> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  const response = await fetch('/api/place-opening-hours', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ placeId }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new PlaceOpeningHoursFailedError(errorBody?.error ?? 'Failed to fetch place opening hours')
  }

  const responseBody = await response.json()
  if (responseBody.status !== 'ok') {
    throw new PlaceOpeningHoursFailedError(responseBody.error ?? 'Place opening hours lookup failed')
  }

  return (responseBody.regularOpeningHours as RegularOpeningHours | null) ?? null
}
