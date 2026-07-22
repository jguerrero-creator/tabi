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

/**
 * True when a reservation's start or end falls outside the trip's current
 * date range (TABI-113). Trip end_date is treated as exclusive, matching
 * Stay's checkout semantics elsewhere (computeAccommodationGaps.ts) — a
 * reservation ending exactly on the trip's end_date is a normal same-day
 * changeover, not "outside".
 */
export function isOutsideTripPeriod(candidate: DatedCandidate, trip: TripPeriod): boolean {
  if (!trip.start_date || !trip.end_date) return false

  const startKey = candidate.start_at ? localDateKey(candidate.start_at, candidate.start_timezone ?? null) : null
  const endKey = candidate.end_at ? localDateKey(candidate.end_at, candidate.end_timezone ?? null) : null

  if (startKey && (startKey < trip.start_date || startKey >= trip.end_date)) return true
  if (endKey && (endKey < trip.start_date || endKey > trip.end_date)) return true
  return false
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
