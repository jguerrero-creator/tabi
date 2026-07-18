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
  return (
    existing.find((other) => other.start_at && other.end_at && rangesOverlap(candidate, { start_at: other.start_at, end_at: other.end_at }))
    ?? null
  )
}

/** Half-open range overlap: touching boundaries (checkout == next check-in) don't count. */
export function rangesOverlap(a: { start_at: string; end_at: string }, b: { start_at: string; end_at: string }): boolean {
  return Date.parse(a.start_at) < Date.parse(b.end_at) && Date.parse(b.start_at) < Date.parse(a.end_at)
}
