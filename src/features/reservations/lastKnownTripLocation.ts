import { localDateKey } from '../../lib/datetime'
import type { TripDayLocation } from '../../types/dayLocation'
import type { Reservation } from '../../types/reservation'

export interface KnownLocation {
  formattedAddress: string
  placeName: string | null
  lat: number
  lng: number
  city: string | null
  timezone: string | null
}

/**
 * TABI-204: the most recently-dated geocoded location already entered for the trip —
 * either a day's planned location or a reservation's own address, whichever is later.
 * A reservation contributes its *end* location when it has a geocoded one (the place
 * the traveler ends up after that leg, e.g. a Transport's arrival point) rather than
 * where they started. Ties (same local day) keep the reservation over the day-location
 * placeholder, since a reservation's address is the more specific/confirmed of the two.
 */
export function lastKnownTripLocation(
  reservations: Reservation[],
  dayLocationsByDate: Map<string, TripDayLocation>,
): KnownLocation | null {
  let bestDayKey: string | null = null
  let best: KnownLocation | null = null

  for (const reservation of reservations) {
    const hasEnd = reservation.end_lat != null && reservation.end_lng != null && Boolean(reservation.end_address)
    const at = hasEnd ? (reservation.end_at ?? reservation.start_at) : reservation.start_at
    const timezone = (hasEnd ? reservation.end_timezone : reservation.start_timezone) ?? null
    const lat = hasEnd ? reservation.end_lat : reservation.start_lat
    const lng = hasEnd ? reservation.end_lng : reservation.start_lng
    const address = hasEnd ? reservation.end_address : reservation.start_address
    if (!at || lat == null || lng == null || !address) continue

    const dayKey = localDateKey(at, timezone)
    if (bestDayKey === null || dayKey > bestDayKey) {
      bestDayKey = dayKey
      best = {
        formattedAddress: address,
        placeName: (hasEnd ? reservation.end_place_name : reservation.start_place_name) ?? null,
        lat,
        lng,
        city: (hasEnd ? reservation.end_city : reservation.start_city) ?? null,
        timezone,
      }
    }
  }

  for (const [dayKey, dayLocation] of dayLocationsByDate) {
    if (bestDayKey !== null && dayKey <= bestDayKey) continue
    bestDayKey = dayKey
    best = {
      formattedAddress: dayLocation.address ?? dayLocation.place_name,
      placeName: dayLocation.place_name,
      lat: dayLocation.lat,
      lng: dayLocation.lng,
      city: dayLocation.city,
      timezone: dayLocation.timezone,
    }
  }

  return best
}
