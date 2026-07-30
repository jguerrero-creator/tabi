import type { Reservation } from '../types/reservation'
import { localDateKey } from './datetime'

/**
 * A reservation as it appears on one specific day. A multi-night Stay
 * contributes two occurrences sharing the same underlying reservation id —
 * one on its check-in day, one on its check-out day — so its checkout is
 * visible on its own day instead of only ever showing up folded into the
 * check-in day's trailing free time. Structurally identical to (and
 * interchangeable with) `DayItem` in `src/features/trips/DayColumn.tsx`,
 * which is defined separately there to avoid this module importing anything
 * React-related — this file needs to stay plain TS so it's importable from
 * server-side (Edge function) code too.
 */
export type DayOccurrence = Reservation & {
  isCheckoutOccurrence?: boolean
  suppressTrailingFreeBlock?: boolean
}

/**
 * Expands each multi-night Stay into two occurrences of the same reservation
 * — a check-in entry on its start day, a check-out entry on its end day — so
 * the checkout shows up as a real, timed rail item on its own day instead of
 * only ever being folded into the check-in day's trailing free time. Every
 * other reservation (and a same-day Stay, if one ever existed) passes through
 * as a single occurrence, unchanged.
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
    occurrences.push(reservation)
  }

  return occurrences.sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''))
}
