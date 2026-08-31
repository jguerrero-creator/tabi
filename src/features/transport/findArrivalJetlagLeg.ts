import { localDateKey, timeZoneOffsetDiffHours } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'

/** 3+ hour timezone offset shift is the common jetlag rule-of-thumb threshold (TABI-66). */
const JETLAG_THRESHOLD_HOURS = 3

/**
 * The point-to-point Transport leg landing on a given local calendar date whose
 * departure/arrival timezone offsets differ by 3+ hours — flagged as "probable
 * jetlag" on the day-tab (TABI-66). Arrival day only, not the day after: this is
 * a low-priority visual nicety, not a modeled recovery period, and one clearly-
 * anchored day (the day the traveler actually lands) is simpler to reason about
 * than guessing how long jetlag lingers. Purely a lookup for the day-tab badge —
 * never wired into `freeTimeBlocks.ts` or any other calculation.
 */
export function findArrivalJetlagLeg(dateKey: string, reservations: Reservation[]): Reservation | null {
  return (
    reservations.find((reservation) => {
      if (reservation.type !== 'transport' || reservation.transport_subtype !== 'point_to_point') return false
      if (!reservation.start_at || !reservation.end_at || !reservation.start_timezone || !reservation.end_timezone)
        return false
      if (localDateKey(reservation.end_at, reservation.end_timezone) !== dateKey) return false
      return (
        timeZoneOffsetDiffHours(
          reservation.start_at,
          reservation.start_timezone,
          reservation.end_at,
          reservation.end_timezone,
        ) >= JETLAG_THRESHOLD_HOURS
      )
    }) ?? null
  )
}
