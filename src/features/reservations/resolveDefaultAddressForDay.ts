import type { TripDayLocation } from '../../types/dayLocation'
import type { Reservation } from '../../types/reservation'
import { findActiveStay } from '../stay/computeAccommodationGaps'
import { lastKnownTripLocation, type KnownLocation } from './lastKnownTripLocation'

/**
 * TABI-267: the default address for a day being planned — day-scoped, unlike
 * `lastKnownTripLocation` (TABI-204), which answers the trip-wide "where did the
 * plan leave off" question regardless of which day is being filled in. Precedence,
 * per the ticket (matches `resolveContextualLocation`'s *intended* rule — note its
 * actual code checks the active accommodation before the day location, the reverse
 * of this; see the Step 0 report, not changed here since that function has its own
 * callers and changing its order is out of this ticket's scope):
 *
 *   1. The day's own explicit planned location (`trip_day_locations`), if set.
 *   2. Else the accommodation active that night (`findActiveStay`).
 *   3. Else the trip-wide TABI-204 fallback (`lastKnownTripLocation`).
 *   4. Else null (caller leaves the field empty).
 *
 * `dateKey` is null whenever the form doesn't know what day it's for yet (opened
 * from a type menu, no date picked) — skips straight to step 3, exactly as TABI-204
 * already behaved before this day-aware layer existed.
 *
 * One shared function, meant for both this ticket's Add-form prefill and the
 * Backlog ticket for a Meal autocomplete's location bias — not copied.
 */
export function resolveDefaultAddressForDay(
  dateKey: string | null,
  reservations: Reservation[],
  dayLocationsByDate: Map<string, TripDayLocation>,
): KnownLocation | null {
  if (dateKey) {
    const dayLocation = dayLocationsByDate.get(dateKey)
    if (dayLocation) {
      return {
        formattedAddress: dayLocation.address ?? dayLocation.place_name,
        placeName: dayLocation.place_name,
        lat: dayLocation.lat,
        lng: dayLocation.lng,
        city: dayLocation.city,
        timezone: dayLocation.timezone,
        source: 'day_location',
      }
    }

    const activeStay = findActiveStay(dateKey, reservations)
    if (activeStay?.start_lat != null && activeStay.start_lng != null && activeStay.start_address) {
      return {
        formattedAddress: activeStay.start_address,
        placeName: activeStay.start_place_name ?? null,
        lat: activeStay.start_lat,
        lng: activeStay.start_lng,
        city: activeStay.start_city ?? null,
        timezone: activeStay.start_timezone ?? null,
        source: 'accommodation',
      }
    }
  }

  return lastKnownTripLocation(reservations, dayLocationsByDate)
}
