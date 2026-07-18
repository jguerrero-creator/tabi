import type { Reservation } from '../../types/reservation'

export interface AccommodationGap {
  /** ISO date (YYYY-MM-DD), inclusive */
  start: string
  /** ISO date (YYYY-MM-DD), exclusive */
  end: string
}

/**
 * Nights of the trip with no stay reservation covering them at all (any status).
 * A gap is a silent absence, not a "to book" reminder — those already show via status.
 */
export function computeAccommodationGaps(
  trip: { start_date: string | null; end_date: string | null },
  reservations: Reservation[],
): AccommodationGap[] {
  if (!trip.start_date || !trip.end_date) return []

  const lastNight = addDays(trip.end_date, -1)
  if (trip.start_date > lastNight) return []

  const covered = new Set<string>()
  for (const reservation of reservations) {
    if (reservation.type !== 'stay' || !reservation.end_at) continue
    // Stay reservations always have start_at (DB constraint: only activities may leave it null).
    const checkIn = dateOnlyInZone(reservation.start_at!, reservation.start_timezone)
    const checkOut = dateOnlyInZone(reservation.end_at, reservation.end_timezone)
    for (let night = checkIn; night < checkOut; night = addDays(night, 1)) {
      covered.add(night)
    }
  }

  const gaps: AccommodationGap[] = []
  let gapStart: string | null = null
  for (let night = trip.start_date; night <= lastNight; night = addDays(night, 1)) {
    if (!covered.has(night)) {
      gapStart ??= night
    } else if (gapStart !== null) {
      gaps.push({ start: gapStart, end: night })
      gapStart = null
    }
  }
  if (gapStart !== null) {
    gaps.push({ start: gapStart, end: addDays(lastNight, 1) })
  }

  return gaps
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dateOnlyInZone(isoUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? 'UTC' }).format(new Date(isoUtc))
}
