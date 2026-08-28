import { localDateKey } from '../../lib/datetime'
import { addDays } from '../stay/computeAccommodationGaps'

interface DatedCandidate {
  start_at?: string | null
  end_at?: string | null
  start_timezone?: string | null
  end_timezone?: string | null
}

interface TripPeriod {
  start_date: string | null
  end_date: string | null
}

export type OutOfPeriodField = 'start' | 'end'

/**
 * Which of a reservation's start/end falls outside the trip's current date
 * range (TABI-113), if any — null when both are within range. `trip.end_date`
 * is stored as the trip's literal, inclusive last day (TripFormModal saves the
 * date picker value as-is; computeAccommodationGaps.ts's "checkout" framing
 * refers to that same date, not a separate exclusive bound one day later) — a
 * reservation whose start OR end falls exactly on the trip's end_date is a
 * normal same-day departure/changeover, not "outside". When both start and
 * end are out of range, start takes priority — the caller uses this to
 * refocus the field the user most likely needs to fix first.
 */
export function outOfPeriodField(candidate: DatedCandidate, trip: TripPeriod): OutOfPeriodField | null {
  if (!trip.start_date || !trip.end_date) return null

  const startKey = candidate.start_at ? localDateKey(candidate.start_at, candidate.start_timezone ?? null) : null
  const endKey = candidate.end_at ? localDateKey(candidate.end_at, candidate.end_timezone ?? null) : null

  if (startKey && (startKey < trip.start_date || startKey > trip.end_date)) return 'start'
  if (endKey && (endKey < trip.start_date || endKey > trip.end_date)) return 'end'
  return null
}

/** The smallest [start_date, end_date) that extends the trip to cover the candidate. */
export function extendedTripRange(
  candidate: DatedCandidate,
  trip: { start_date: string; end_date: string },
): { start_date: string; end_date: string } {
  const startKey = candidate.start_at ? localDateKey(candidate.start_at, candidate.start_timezone ?? null) : null
  const endKey = candidate.end_at ? localDateKey(candidate.end_at, candidate.end_timezone ?? null) : null

  const lowerBound = startKey ?? endKey
  const upperBound = endKey ?? (startKey ? addDays(startKey, 1) : null)

  return {
    start_date: lowerBound && lowerBound < trip.start_date ? lowerBound : trip.start_date,
    end_date: upperBound && upperBound > trip.end_date ? upperBound : trip.end_date,
  }
}
