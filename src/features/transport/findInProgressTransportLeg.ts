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
