import { localDateKey } from '../../lib/datetime'
import type { TripDayLocation } from '../../types/dayLocation'
import type { NewReservation } from '../../types/reservation'
import { addDays } from '../stay/computeAccommodationGaps'

type ReservationCandidate = Pick<
  NewReservation,
  | 'type'
  | 'transport_subtype'
  | 'start_at'
  | 'end_at'
  | 'start_timezone'
  | 'end_timezone'
  | 'start_city'
  | 'end_city'
>

export interface LocationMismatch {
  dayKey: string
  reservationCity: string
  plannedCity: string
}

/**
 * The local calendar day(s) a reservation occupies, mapped to the city it puts
 * the traveler in that day (TABI-116). Mirrors each type's existing "coverage"
 * semantics elsewhere: Stay is check-in <= day < check-out, same exclusive-checkout
 * rule as computeAccommodationGaps.ts. at_disposal only claims its start/end days —
 * mid-rental days follow that day's planned location or active accommodation instead
 * (CLAUDE.md #5b), not this reservation.
 */
export function reservationCityByDay(input: ReservationCandidate): Map<string, string> {
  const byDay = new Map<string, string>()
  if (!input.start_at) return byDay

  const startKey = localDateKey(input.start_at, input.start_timezone ?? null)
  const endKey = input.end_at ? localDateKey(input.end_at, input.end_timezone ?? null) : null

  if (input.type === 'stay') {
    if (!input.start_city || !endKey) return byDay
    for (let day = startKey; day < endKey; day = addDays(day, 1)) {
      byDay.set(day, input.start_city)
    }
    return byDay
  }

  // Point-to-point and at_disposal transport both put the traveler in the
  // departure/pickup city on the start day, and the arrival/drop-off city on
  // the end day once they've actually landed there (same day or the next).
  if (input.type === 'transport') {
    if (input.start_city) byDay.set(startKey, input.start_city)
    if (endKey && input.end_city) byDay.set(endKey, input.end_city)
    return byDay
  }

  // Activity: a single day, wherever it's located.
  if (input.start_city) byDay.set(startKey, input.start_city)
  return byDay
}

/**
 * First day where a reservation's city differs from that day's planned location
 * (TABI-116) — never blocking, just surfaced so the traveler can confirm it's
 * intentional ("this reservation is in Osaka, but Kyoto was planned for that day").
 */
export function findLocationMismatch(
  input: ReservationCandidate,
  dayLocationsByDate: Map<string, TripDayLocation>,
): LocationMismatch | null {
  for (const [dayKey, reservationCity] of reservationCityByDay(input)) {
    const planned = dayLocationsByDate.get(dayKey)
    if (!planned?.city) continue
    if (normalizeCity(planned.city) === normalizeCity(reservationCity)) continue
    return { dayKey, reservationCity, plannedCity: planned.city }
  }
  return null
}

function normalizeCity(city: string): string {
  return city.trim().toLowerCase()
}
