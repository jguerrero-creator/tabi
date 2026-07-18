import type { Reservation } from '../types/reservation'
import { legKey } from './tripLegs'

export interface FreeTimeBlock {
  fromReservationId: string
  toReservationId: string
  /** UTC ISO string — when free time starts (the earlier reservation's end). */
  start: string
  /** UTC ISO string — when free time ends (next reservation's start, minus travel time). */
  end: string
  durationSeconds: number
}

interface LegDuration {
  fromReservationId: string
  toReservationId: string
  durationSeconds: number | null
}

/**
 * Free time between two consecutive reservations = the gap between them minus
 * the travel time needed to get from one to the other — the core "actual free
 * time, not generic guide time" calculation. All arithmetic is done on UTC
 * instants (`start_at`/`end_at` epoch millis), never on displayed local
 * wall-clock strings, so it stays correct across timezone changes and DST.
 */
export function computeFreeTimeBlocks(reservations: Reservation[], legs: LegDuration[]): FreeTimeBlock[] {
  const travelSecondsByLeg = new Map(
    legs.map((leg) => [legKey(leg.fromReservationId, leg.toReservationId), leg.durationSeconds ?? 0]),
  )

  const scheduled = reservations.filter(
    (reservation): reservation is Reservation & { start_at: string } => reservation.start_at !== null,
  )
  const sorted = [...scheduled].sort((a, b) => a.start_at.localeCompare(b.start_at))

  const blocks: FreeTimeBlock[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]
    const to = sorted[i + 1]
    const fromEnd = from.end_at ?? from.start_at
    const gapMs = Date.parse(to.start_at) - Date.parse(fromEnd)
    if (gapMs <= 0) continue

    const travelSeconds = travelSecondsByLeg.get(legKey(from.id, to.id)) ?? 0
    const freeSeconds = gapMs / 1000 - travelSeconds
    if (freeSeconds <= 0) continue

    blocks.push({
      fromReservationId: from.id,
      toReservationId: to.id,
      start: fromEnd,
      end: new Date(Date.parse(to.start_at) - travelSeconds * 1000).toISOString(),
      durationSeconds: freeSeconds,
    })
  }

  return blocks
}
