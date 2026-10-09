import { localDateKey, localTimeZone } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'

export interface BookByBadgeInfo {
  /** Signed days from today to the book-by date (book_by_date minus today). Zero or
   * positive means there's still time (green); negative means overdue (red). */
  days: number
  overdue: boolean
}

/**
 * New feature request, 2026-09-30: an optional "book by" target date for a "To book"
 * reservation, shown as a small days-remaining/overdue badge next to its status pill.
 * Returns null whenever the badge shouldn't be shown at all:
 * - no book_by_date set (entirely optional, decided behavior #1)
 * - status isn't "to_book" (meaningless once booked/decided, decided behavior #2)
 * - the reservation's own scheduled date has arrived — once you're at/past the actual
 *   event the target date is moot regardless of book-by status (decided behavior #3).
 *   A reservation with no date of its own yet (e.g. an unscheduled Activity) has no
 *   cutoff to apply, so the badge still shows.
 */
export function bookByBadgeInfo(reservation: Reservation): BookByBadgeInfo | null {
  if (reservation.status !== 'to_book' || !reservation.book_by_date) return null

  const todayKey = localDateKey(new Date().toISOString(), localTimeZone())

  if (reservation.start_at) {
    const ownDateKey = localDateKey(reservation.start_at, reservation.start_timezone)
    if (todayKey >= ownDateKey) return null
  }

  const days = daysBetween(todayKey, reservation.book_by_date)
  return { days, overdue: days < 0 }
}

/** Signed day count from `fromDateKey` to `toDateKey` (both YYYY-MM-DD), diffed at UTC
 * midnight — same epoch-diff approach as computeAccommodationGaps.ts's nightsBetween,
 * just signed rather than floored to a minimum of 1 night. */
function daysBetween(fromDateKey: string, toDateKey: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round(
    (new Date(`${toDateKey}T00:00:00Z`).getTime() - new Date(`${fromDateKey}T00:00:00Z`).getTime()) / msPerDay,
  )
}
