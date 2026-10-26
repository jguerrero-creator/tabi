import { buildDayOccurrences, type DayOccurrence } from './dayOccurrences'
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

export interface LegEndpointPlace {
  formattedAddress: string
  lat: number
  lng: number
  timezone: string
  city: string | null
  placeName: string | null
}

/**
 * TABI-155: resolves a leg's endpoint (a plain `LatLng` computed by
 * `buildTripLegs`) back to the rich address it came from, by matching
 * coordinates against the reservation's own end/start fields — needed to
 * prefill the Add-reservation sheet from a computed "Getting Around" leg.
 * Returns null when the point doesn't match either of the reservation's own
 * addresses (TABI-124: a day anchored to a planned location or active stay
 * instead of a reservation endpoint) or when the matching side has no address
 * text to prefill with.
 */
export function resolveLegEndpointPlace(reservation: Reservation, latLng: LatLng): LegEndpointPlace | null {
  for (const which of ['end', 'start'] as const) {
    const lat = which === 'end' ? reservation.end_lat : reservation.start_lat
    const lng = which === 'end' ? reservation.end_lng : reservation.start_lng
    const timezone = which === 'end' ? reservation.end_timezone : reservation.start_timezone
    const address = which === 'end' ? reservation.end_address : reservation.start_address
    if (lat === latLng.lat && lng === latLng.lng && timezone && address) {
      return {
        formattedAddress: address,
        lat,
        lng,
        timezone,
        city: which === 'end' ? reservation.end_city : reservation.start_city,
        placeName: which === 'end' ? reservation.end_place_name : reservation.start_place_name,
      }
    }
  }
  return null
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
 *
 * Pairs `buildDayOccurrences`' output rather than the raw reservation list,
 * same reasoning as `computeFreeTimeBlocks` — otherwise a Stay's checkout (or
 * a Transport's arrival) is invisible to this pairing and a reservation
 * sandwiched between check-in and checkout gets a leg computed straight
 * through to whatever comes after checkout, instead of to/from the checkout
 * itself.
 *
 * Tracks a running `dominant` occurrence while sweeping the sorted list — the
 * longest-reaching non-rental occurrence still "in effect" (ties: whichever
 * started latest, same rule `buildOccupiedClusters` uses) — and substitutes
 * it in as the real departure point whenever the next occurrence chronologically
 * is still nested inside it (Bugs: "Faux temps libre quand une réservation
 * est imbriquée dans une plage plus longue" — the traveler hasn't actually
 * left the longer-running reservation just because a nested, earlier-ending
 * one has ended). This is deliberately NOT simplified to the same
 * cluster-boundary pairing `computeFreeTimeBlocks` uses: an at-disposal
 * rental's own nested stops must keep generating their own individual,
 * sequential point-to-point legs (TABI-124) rather than collapsing onto one
 * leg per merged interval — a rental is therefore never tracked as
 * `dominant`, and a leg into a reservation still nested inside *it*
 * specifically keeps using the existing `isCoveredByRental` anchor instead.
 * Whenever this substitution DOES produce a cluster-boundary-crossing leg,
 * its `fromReservationId` is proven to match `buildOccupiedClusters`' own
 * `owner` choice for that same boundary — `computeFreeTimeBlocks`'s
 * `legByPair` lookup depends on this staying true.
 */
export function buildTripLegs(
  reservations: Reservation[],
  resolveCoveredDayAnchor?: (dateKey: string) => LatLng | null,
): TripLegInput[] {
  // Reservations without a start_at ("decide later", no date yet) have no place
  // in a chronological sequence, so they're excluded from consecutive pairing.
  const scheduled = buildDayOccurrences(reservations).filter(
    (reservation): reservation is DayOccurrence & { start_at: string } => reservation.start_at !== null,
  )
  const sorted = [...scheduled].sort((a, b) => a.start_at.localeCompare(b.start_at))
  const legs: TripLegInput[] = []

  let dominant: (DayOccurrence & { start_at: string }) | null = null

  for (let i = 0; i < sorted.length - 1; i++) {
    const rawFrom = sorted[i]
    const to = sorted[i + 1]
    const rawFromEnd = rawFrom.end_at ?? rawFrom.start_at
    const isRentalFrom = rawFrom.type === 'transport' && rawFrom.transport_subtype === 'at_disposal'

    // Update `dominant` unconditionally, before any `continue` below — later
    // iterations need it even for a pair this one doesn't itself emit a leg
    // for (e.g. a Stay's check-in occurrence, skipped just below).
    const dominantEnd = dominant ? (dominant.end_at ?? dominant.start_at) : null
    if (!(dominant && dominantEnd !== null && rawFrom.start_at < dominantEnd)) {
      // Not nested inside the previous dominant — start fresh. A rental is
      // never tracked as dominant (see doc comment above).
      dominant = isRentalFrom ? null : rawFrom
    } else if (!isRentalFrom && (dominant.suppressTrailingFreeBlock || rawFromEnd >= dominantEnd)) {
      // Still nested inside the previous dominant. A Stay check-in /
      // Transport departure's `end_at` is only an artificial placeholder
      // reaching to its real checkout/arrival, never a genuine
      // continuous-occupancy span — it must always cede to a real
      // occurrence nested before that real end, or that occurrence's own
      // leg to whatever follows it would wrongly collapse behind the
      // placeholder instead (same bug class, mirrored in
      // `buildOccupiedClusters`). Two real occurrences still tie-break on
      // whichever reaches at least as far, same rule as there.
      dominant = rawFrom
    }

    // A Stay check-in / Transport departure occurrence's real trailing gap
    // belongs to its check-out/arrival occurrence's own slot instead (same
    // flag `computeFreeTimeBlocks` and the rail use to suppress this) — skip
    // it here too, or this pairing would compute a leg "from" an occurrence
    // whose own occupancy hasn't actually ended yet at this point in the
    // sequence (e.g. into a reservation that starts before the real checkout).
    if (rawFrom.suppressTrailingFreeBlock) continue

    const from = dominant && !isRentalFrom ? dominant : rawFrom
    const fromEnd = from.end_at ?? from.start_at

    const isCoveredByRental =
      rawFrom.type === 'transport' &&
      rawFrom.transport_subtype === 'at_disposal' &&
      rawFrom.end_at !== null &&
      to.start_at < rawFrom.end_at

    // `to` is still nested inside the real departure point's span — nothing
    // to travel to yet, the enclosing reservation remains "in progress"
    // until its own end (unless that span is an at-disposal rental, where
    // being covered by it is the whole point, handled below instead).
    if (!isCoveredByRental && to.start_at < fromEnd) continue

    const origin = isCoveredByRental
      ? (resolveCoveredDayAnchor?.(localDateKey(to.start_at, to.start_timezone)) ?? null)
      : (pointOf(from, 'end') ?? pointOf(from, 'start'))
    const departureTime = isCoveredByRental ? to.start_at : fromEnd

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
