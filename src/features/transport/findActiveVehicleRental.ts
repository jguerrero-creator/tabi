import { dateKeyOverlapsRange } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'

/**
 * The at-disposal vehicle rental covering a given local calendar date, if any —
 * inclusive of both the pickup and drop-off day (TABI-143), unlike a Stay's
 * checkout day which is exclusive (TABI-124's day-location fallback treats
 * both ends as "covered" too).
 *
 * Bugs DB, Majeur — this used to compare `pickup`/`dropoff` as local
 * calendar-date *strings*, each computed in its own (potentially different)
 * timezone. When the two zones are far enough apart (~20h+ offset spread),
 * the drop-off's local date string can read lexicographically *earlier* than
 * the pickup's even though the drop-off instant is strictly later in real
 * time — inverting the range so no `dateKey` ever matched, including the
 * rental's own pickup/drop-off days. `dateKeyOverlapsRange` compares real UTC
 * instants instead, so no such inversion is possible.
 */
export function findActiveVehicleRental(dateKey: string, reservations: Reservation[]): Reservation | null {
  return (
    reservations.find((reservation) => {
      if (reservation.type !== 'transport' || reservation.transport_subtype !== 'at_disposal') return false
      if (!reservation.start_at || !reservation.end_at) return false
      return dateKeyOverlapsRange(dateKey, reservation.start_at, reservation.end_at)
    }) ?? null
  )
}
