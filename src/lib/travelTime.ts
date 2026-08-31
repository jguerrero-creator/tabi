export interface LatLng {
  lat: number
  lng: number
}

export type TravelMode = 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT' | 'TRAIN'

export interface TravelTimeResult {
  durationSeconds: number | null
  distanceMeters: number | null
  /** TABI-88: true when the Routes API's own transit steps confirm a same-station transfer. Always false for non-transit modes. */
  hasDirectTransfer: boolean
}

export async function fetchTravelTime(
  origin: LatLng,
  destination: LatLng,
  mode: TravelMode = 'DRIVE',
  departureTime?: string,
): Promise<TravelTimeResult> {
  const response = await fetch('/api/travel-time', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, destination, mode, departureTime }),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch travel time')
  }

  return response.json()
}
