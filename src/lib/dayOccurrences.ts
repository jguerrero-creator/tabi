import type { Reservation } from '../types/reservation'
import { localDateKey } from './datetime'

/**
 * A reservation as it appears on one specific day. A multi-night Stay
 * contributes two occurrences sharing the same underlying reservation id —
 * one on its check-in day, one on its check-out day — so its checkout is
 * visible on its own day instead of only ever showing up folded into the
 * check-in day's trailing free time. A point-to-point Transport leg that
 * actually spans more than one local calendar day is split the same way — a
 * departure occurrence and an arrival occurrence — so it's always visible
 * (and correctly occupies free time) on both its departure and arrival day
 * (Bugs: "Un trajet Transport qui traverse minuit... n'apparaît que sur le
 * jour de départ"; and "Comparaison de dates locales dans des fuseaux
 * différents peut coïncider par erreur" — comparing local date *strings*
 * computed in two different timezones can spuriously "match" even across a
 * leg lasting most of a day). The split briefly became fully unconditional to
 * fix that second bug, which introduced a regression of its own (Bugs DB,
 * Majeur — "Le split Départ/Arrivée inconditionnel fait compter en double les
 * Transport sur une même journée": every same-day, same-timezone leg — a
 * train, a taxi, any ordinary domestic hop — was duplicated into two rail
 * cards and inflated the day-tab item count by one). See `buildDayOccurrences`
 * below for the condition it now uses instead, and why that one is safe.
 * Structurally identical to (and interchangeable with) `DayItem` in
 * `src/features/trips/DayColumn.tsx`, which is defined separately there to
 * avoid this module importing anything React-related — this file needs to
 * stay plain TS so it's importable from server-side (Edge function) code too.
 */
export type DayOccurrence = Reservation & {
  /** True for the check-out occurrence of a multi-night Stay. */
  isCheckoutOccurrence?: boolean
  /** True for the arrival occurrence of a point-to-point Transport leg. */
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
 * Does the same for a point-to-point Transport leg that actually spans more
 * than one local calendar day — a departure occurrence and an arrival
 * occurrence, so the leg is visible on both its departure and arrival day and
 * the traveler is treated as occupied for its full real duration. "Spans more
 * than one day" is decided by comparing the departure and arrival dates *in a
 * single shared timezone* — the leg's own, since both ends must agree for the
 * comparison to be meaningful at all. Comparing local calendar-date strings
 * computed in two DIFFERENT timezones is invalid — it can coincidentally read
 * the same even when the real elapsed time is close to a full day (e.g. a
 * long-haul leg where the destination's local date happens to still match the
 * origin's), silently treating most of a real journey as free time (Bugs DB,
 * Bloquant) — so whenever the two ends don't share one timezone, the split
 * always applies, conservatively, rather than risk that comparison. Only a
 * leg confirmed (via one shared zone) to start and end on the same local date
 * stays a single occurrence, exactly as it rendered before either bug fix.
 *
 * Every other reservation type passes through as a single occurrence,
 * unchanged. A leg spanning 2+ calendar days (an intermediate day with
 * neither the departure nor the arrival) isn't covered by this split alone —
 * that's handled separately by `findInProgressTransportLeg`, consulted by
 * `computeDayEdgeFreeBlocks`.
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
      // Only a leg whose two ends share one IANA timezone can have its dates
      // compared at all — reading both instants through that single zone is
      // always valid, unlike comparing two dates each computed in its own,
      // different zone (Bugs DB, Bloquant — "Comparaison de dates locales dans
      // des fuseaux différents peut coïncider par erreur"). Different
      // timezones always split, conservatively, without ever making that
      // comparison.
      const sameZone = reservation.start_timezone === reservation.end_timezone
      const spansMultipleDays =
        !sameZone ||
        localDateKey(reservation.start_at, reservation.start_timezone) !==
          localDateKey(reservation.end_at, reservation.end_timezone)

      if (spansMultipleDays) {
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
