import { localDateKey } from './datetime'
import type { Reservation } from '../types/reservation'
import type { LatLng } from './travelTime'

export interface TripLegInput {
  fromReservationId: string
  toReservationId: string
  /**
   * Null means "a leg is needed but no location can be resolved" (TABI-124: a
   * day covered by an at-disposal vehicle rental, with no planned location or
   * active accommodation to anchor it) — callers must treat this as unknown,
   * not as a same-location/no-travel-needed leg.
   */
  origin: LatLng | null
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
 *
 * TABI-124: an at-disposal vehicle rental's own end point is its drop-off —
 * correct for the leg *after* the rental ends, but wrong for anything
 * scheduled *during* the rental (the traveler hasn't dropped off the car yet,
 * so the drop-off coordinate doesn't represent where they are that day).
 * `resolveCoveredDayAnchor` supplies a substitute location for that day
 * instead (the day's planned location, or its active accommodation).
 */
export function buildTripLegs(
  reservations: Reservation[],
  resolveCoveredDayAnchor?: (dateKey: string) => LatLng | null,
): TripLegInput[] {
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

    const isCoveredByRental =
      from.type === 'transport' &&
      from.transport_subtype === 'at_disposal' &&
      from.end_at !== null &&
      to.start_at < from.end_at

    const origin = isCoveredByRental
      ? (resolveCoveredDayAnchor?.(localDateKey(to.start_at, to.start_timezone)) ?? null)
      : (pointOf(from, 'end') ?? pointOf(from, 'start'))
    const departureTime = isCoveredByRental ? to.start_at : (from.end_at ?? from.start_at)

    const destination = pointOf(to, 'start')
    if (!destination) continue
    if (!isCoveredByRental && !origin) continue
    if (origin && origin.lat === destination.lat && origin.lng === destination.lng) continue

    legs.push({
      fromReservationId: from.id,
      toReservationId: to.id,
      origin,
      destination,
      departureTime,
    })
  }

  return legs
}

function pointOf(reservation: Reservation, which: 'start' | 'end'): LatLng | null {
  const lat = which === 'start' ? reservation.start_lat : reservation.end_lat
  const lng = which === 'start' ? reservation.start_lng : reservation.end_lng
  return lat !== null && lng !== null ? { lat, lng } : null
}
