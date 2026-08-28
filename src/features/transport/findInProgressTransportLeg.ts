import { localDateKey } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'

/**
 * The point-to-point Transport leg still in progress (airborne/en route)
 * through an entire given local calendar date — i.e. a leg whose departure
 * and arrival both fall on days other than `dateKey` (a leg spanning 2+
 * calendar days). The departure day and arrival day are already covered by
 * `buildDayOccurrences`'s departure/arrival split, each getting its own real
 * rail occurrence; this only catches the day(s) strictly between them, which
 * would otherwise have no items at all and render as one big (wrong)
 * full-day free block.
 */
export function findInProgressTransportLeg(dateKey: string, reservations: Reservation[]): Reservation | null {
  return (
    reservations.find((reservation) => {
      if (reservation.type !== 'transport' || reservation.transport_subtype !== 'point_to_point') return false
      if (!reservation.start_at || !reservation.end_at) return false
      const departureDay = localDateKey(reservation.start_at, reservation.start_timezone)
      const arrivalDay = localDateKey(reservation.end_at, reservation.end_timezone)
      return departureDay < dateKey && dateKey < arrivalDay
    }) ?? null
  )
}

/**
 * Whether any point-to-point Transport leg touches a given calendar night at all —
 * departure falls on that night, or the leg is still in progress through it (per
 * `findInProgressTransportLeg`). Binary, no partial credit: a leg touching 10 minutes
 * of the night (e.g. departs 23:00, arrives 02:00) suppresses an accommodation gap the
 * same as one spanning the whole night. Deliberately excludes the arrival day itself —
 * landing at 02:00 doesn't cover that day's following night, only the one before it.
 */
export function transportTouchesNight(night: string, reservations: Reservation[]): boolean {
  if (findInProgressTransportLeg(night, reservations)) return true
  return reservations.some((reservation) => {
    if (reservation.type !== 'transport' || reservation.transport_subtype !== 'point_to_point') return false
    if (!reservation.start_at || !reservation.end_at) return false
    return localDateKey(reservation.start_at, reservation.start_timezone) === night
  })
}
