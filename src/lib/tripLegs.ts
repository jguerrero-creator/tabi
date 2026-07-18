import type { Reservation } from '../types/reservation'
import type { LatLng } from './travelTime'

export interface TripLegInput {
  fromReservationId: string
  toReservationId: string
  origin: LatLng
  destination: LatLng
  /** UTC ISO string — the departing reservation's end time, falling back to its start time. */
  departureTime: string
}

export function legKey(fromReservationId: string, toReservationId: string): string {
  return `${fromReservationId}->${toReservationId}`
}

/**
 * Pairs each reservation with the next one chronologically and returns the
 * legs that need a travel-time lookup — i.e. both ends are geocoded and the
 * locations actually differ. Reservations without a distinct end location
 * (stay, activity) use their single point for both arrival and departure.
 */
export function buildTripLegs(reservations: Reservation[]): TripLegInput[] {
  // Reservations without a start_at ("decide later", no date yet) have no place
  // in a chronological sequence, so they're excluded from consecutive pairing.
  const scheduled = reservations.filter(
    (reservation): reservation is Reservation & { start_at: string } => reservation.start_at !== null,
  )
  const sorted = [...scheduled].sort((a, b) => a.start_at.localeCompare(b.start_at))
  const legs: TripLegInput[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]
    const to = sorted[i + 1]

    const origin = pointOf(from, 'end') ?? pointOf(from, 'start')
    const destination = pointOf(to, 'start')
    if (!origin || !destination) continue
    if (origin.lat === destination.lat && origin.lng === destination.lng) continue

    legs.push({
      fromReservationId: from.id,
      toReservationId: to.id,
      origin,
      destination,
      departureTime: from.end_at ?? from.start_at,
    })
  }

  return legs
}

function pointOf(reservation: Reservation, which: 'start' | 'end'): LatLng | null {
  const lat = which === 'start' ? reservation.start_lat : reservation.end_lat
  const lng = which === 'start' ? reservation.start_lng : reservation.end_lng
  return lat !== null && lng !== null ? { lat, lng } : null
}
