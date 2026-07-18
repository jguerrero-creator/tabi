import { rangesOverlap } from '../../features/reservations/reservationOverlap'
import type { Reservation } from '../../types/reservation'

type RangedReservation = Reservation & { start_at: string; end_at: string }

export interface OverlapNesting {
  nestedIds: Set<string>
  childrenByMainId: Map<string, RangedReservation[]>
}

/**
 * Same-type reservations may legitimately overlap (TABI-108/109 — confirmed
 * intentional at save time, e.g. a night booked elsewhere in the middle of a
 * longer stay). Per the Decision Log, a confirmed overlap renders
 * nested/indented under the longer reservation rather than as its own date
 * section. Ties break on the earlier start_at.
 */
export function nestOverlappingReservations(reservations: Reservation[]): OverlapNesting {
  const withRange = reservations.filter(
    (reservation): reservation is RangedReservation => reservation.start_at !== null && reservation.end_at !== null,
  )

  const mainForChild = new Map<string, RangedReservation>()

  for (const candidate of withRange) {
    const candidateDuration = durationMs(candidate)
    let main: RangedReservation | null = null
    let mainDuration = -1

    for (const other of withRange) {
      if (other.id === candidate.id || !rangesOverlap(candidate, other)) continue

      const otherDuration = durationMs(other)
      const otherOutranksCandidate =
        otherDuration > candidateDuration ||
        (otherDuration === candidateDuration && other.start_at < candidate.start_at)

      if (otherOutranksCandidate && otherDuration > mainDuration) {
        main = other
        mainDuration = otherDuration
      }
    }

    if (main) mainForChild.set(candidate.id, main)
  }

  const childrenByMainId = new Map<string, RangedReservation[]>()
  for (const [childId, main] of mainForChild) {
    const child = withRange.find((reservation) => reservation.id === childId)!
    const siblings = childrenByMainId.get(main.id) ?? []
    siblings.push(child)
    childrenByMainId.set(main.id, siblings)
  }
  for (const siblings of childrenByMainId.values()) {
    siblings.sort((a, b) => a.start_at.localeCompare(b.start_at))
  }

  return { nestedIds: new Set(mainForChild.keys()), childrenByMainId }
}

function durationMs(reservation: { start_at: string; end_at: string }): number {
  return Date.parse(reservation.end_at) - Date.parse(reservation.start_at)
}
