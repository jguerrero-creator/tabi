import { localDateKey } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'

/**
 * The at-disposal vehicle rental covering a given local calendar date, if any —
 * inclusive of both the pickup and drop-off day (TABI-143), unlike a Stay's
 * checkout day which is exclusive (TABI-124's day-location fallback treats
 * both ends as "covered" too).
 */
export function findActiveVehicleRental(dateKey: string, reservations: Reservation[]): Reservation | null {
  return (
    reservations.find((reservation) => {
      if (reservation.type !== 'transport' || reservation.transport_subtype !== 'at_disposal') return false
      if (!reservation.start_at || !reservation.end_at) return false
      const pickup = localDateKey(reservation.start_at, reservation.start_timezone)
      const dropoff = localDateKey(reservation.end_at, reservation.end_timezone)
      return dateKey >= pickup && dateKey <= dropoff
    }) ?? null
  )
}
