import type { Reservation } from '../../types/reservation'

/**
 * Finds an existing reservation whose [start_at, end_at) range overlaps the
 * candidate's — e.g. two hotel stays covering the same night, or two flights
 * in the air at once. Touching boundaries (checkout == next check-in) don't
 * count as an overlap. Callers are expected to pre-filter `existing` to the
 * same reservation type (overlap is only meaningful within Stay or within
 * Transport, per TABI-108).
 */
export function findOverlappingReservation(
  candidate: { start_at: string; end_at: string },
  existing: Reservation[],
): Reservation | null {
  const candidateStart = Date.parse(candidate.start_at)
  const candidateEnd = Date.parse(candidate.end_at)

  return (
    existing.find((other) => {
      if (!other.start_at || !other.end_at) return false
      return candidateStart < Date.parse(other.end_at) && Date.parse(other.start_at) < candidateEnd
    }) ?? null
  )
}
