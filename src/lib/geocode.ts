export interface GeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
  timezone: string
}

export async function fetchGeocode(address: string): Promise<GeocodeResult> {
  const response = await fetch('/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? 'Failed to geocode address')
  }

  return response.json()
}
