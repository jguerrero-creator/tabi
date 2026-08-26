import type { Reservation } from '../types/reservation'
import { localDateKey } from './datetime'

/**
 * A reservation as it appears on one specific day. A multi-night Stay
 * contributes two occurrences sharing the same underlying reservation id —
 * one on its check-in day, one on its check-out day — so its checkout is
 * visible on its own day instead of only ever showing up folded into the
 * check-in day's trailing free time. A midnight/timezone-crossing
 * point-to-point Transport leg is split the same way — a departure occurrence
 * and an arrival occurrence — so it's visible (and correctly occupies free
 * time) on both days instead of only its departure day (Bugs: "Un trajet
 * Transport qui traverse minuit... n'apparaît que sur le jour de départ").
 * Structurally identical to (and interchangeable with) `DayItem` in
 * `src/features/trips/DayColumn.tsx`, which is defined separately there to
 * avoid this module importing anything React-related — this file needs to
 * stay plain TS so it's importable from server-side (Edge function) code too.
 */
export type DayOccurrence = Reservation & {
  /** True for the check-out occurrence of a multi-night Stay. */
  isCheckoutOccurrence?: boolean
  /** True for the arrival occurrence of a midnight-crossing Transport leg. */
  isArrivalOccurrence?: boolean
  /**
   * Suppresses the pairwise free-time block keyed off this occurrence's id
   * (`DayColumn.buildRailEntries`) — the real gap after this reservation ends
   * is attributed to its other occurrence's own day instead, to avoid
   * double-counting the same stretch of time on both days.
   */
  suppressTrailingFreeBlock?: boolean
  /**
   * Suppresses the day-window *leading* free block before this occurrence
   * (`computeDayEdgeFreeBlocks`) — used on a Transport arrival occurrence,
   * where the traveler was already occupied (in transit) before this day's
   * window even opened, so there is no free time to show before it.
   */
  suppressLeadingDayEdge?: boolean
  /**
   * Suppresses the day-window *trailing* free block after this occurrence
   * (`computeDayEdgeFreeBlocks`) — used on a Transport departure occurrence,
   * where the traveler remains occupied (in transit) for the rest of this
   * day's window, unlike a Stay check-in (which leaves the traveler free
   * again immediately).
   */
  suppressTrailingDayEdge?: boolean
}

/**
 * Expands each multi-night Stay into two occurrences of the same reservation
 * — a check-in entry on its start day, a check-out entry on its end day — so
 * the checkout shows up as a real, timed rail item on its own day instead of
 * only ever being folded into the check-in day's trailing free time.
 *
 * Does the same for a point-to-point Transport leg whose departure and
 * arrival land on different local calendar dates (different timezones, or
 * simply an overnight leg) — a departure occurrence and an arrival
 * occurrence, so the leg is visible on both days and the traveler is treated
 * as occupied for its full real duration rather than "free" for whichever
 * part of the journey fell outside the departure day's own rendering.
 *
 * Every other reservation (and a same-day Stay/Transport, if one ever
 * existed) passes through as a single occurrence, unchanged. A leg spanning
 * 2+ calendar days (an intermediate day with neither the departure nor the
 * arrival) isn't covered by this split alone — that's handled separately by
 * `findInProgressTransportLeg`, consulted by `computeDayEdgeFreeBlocks`.
 */
export function buildDayOccurrences(reservations: Reservation[]): DayOccurrence[] {
  const occurrences: DayOccurrence[] = []

  for (const reservation of reservations) {
    if (reservation.type === 'stay' && reservation.start_at && reservation.end_at) {
      const checkInDay = localDateKey(reservation.start_at, reservation.start_timezone)
      const checkOutDay = localDateKey(reservation.end_at, reservation.end_timezone)
      if (checkInDay !== checkOutDay) {
        occurrences.push({ ...reservation, suppressTrailingFreeBlock: true })
        occurrences.push({
          ...reservation,
          start_at: reservation.end_at,
          start_timezone: reservation.end_timezone,
          isCheckoutOccurrence: true,
        })
        continue
      }
    }

    if (
      reservation.type === 'transport' &&
      reservation.transport_subtype === 'point_to_point' &&
      reservation.start_at &&
      reservation.end_at
    ) {
      const departureDay = localDateKey(reservation.start_at, reservation.start_timezone)
      const arrivalDay = localDateKey(reservation.end_at, reservation.end_timezone)
      if (departureDay !== arrivalDay) {
        occurrences.push({
          ...reservation,
          suppressTrailingFreeBlock: true,
          suppressTrailingDayEdge: true,
        })
        occurrences.push({
          ...reservation,
          start_at: reservation.end_at,
          start_timezone: reservation.end_timezone,
          isArrivalOccurrence: true,
          suppressLeadingDayEdge: true,
        })
        continue
      }
    }

    occurrences.push(reservation)
  }

  return occurrences.sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''))
}
