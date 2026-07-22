import type { Reservation } from '../types/reservation'
import { zonedTimeToUtc } from './datetime'
import { legKey } from './tripLegs'
import type { TravelMode } from './travelTime'

export interface FreeTimeBlock {
  fromReservationId: string
  toReservationId: string
  /** UTC ISO string — when free time starts (the earlier reservation's end). */
  start: string
  /** UTC ISO string — when free time ends (next reservation's start, minus travel time). */
  end: string
  /**
   * Free seconds remaining after travel time. Negative means travel eats the
   * whole gap and then some — a tight or impossible connection, not "no
   * free time" — callers should surface that rather than hide it.
   */
  durationSeconds: number
  /** Raw travel time for this leg (0 when no leg/geocoding was needed). */
  travelSeconds: number
  /** True when travelSeconds meets or exceeds the too-long-travel threshold (TABI-6). */
  tooLongTravel: boolean
  /** Transport mode used for this leg's travel-time lookup (defaults to DRIVE when no leg was needed). */
  mode: TravelMode
}

interface LegDuration {
  fromReservationId: string
  toReservationId: string
  durationSeconds: number | null
  mode: TravelMode | null
}

/** Free blocks shorter than this aren't worth surfacing to the user as "free time". */
export const MIN_FREE_SECONDS_TO_SHOW = 5 * 60

/**
 * A single leg's travel time at or above this is flagged as "too long" (TABI-6),
 * regardless of country/transport mode — this is a plain parameter, not a value
 * tuned for any one region's transport network, so callers can override it
 * (e.g. from a future per-trip or per-user setting) without touching the
 * calculation itself.
 */
export const DEFAULT_MAX_TRAVEL_SECONDS = 4 * 60 * 60

/**
 * Free time between two consecutive reservations = the gap between them minus
 * the travel time needed to get from one to the other — the core "actual free
 * time, not generic guide time" calculation. All arithmetic is done on UTC
 * instants (`start_at`/`end_at` epoch millis), never on displayed local
 * wall-clock strings, so it stays correct across timezone changes and DST.
 */
export function computeFreeTimeBlocks(
  reservations: Reservation[],
  legs: LegDuration[],
  maxTravelSeconds: number = DEFAULT_MAX_TRAVEL_SECONDS,
): FreeTimeBlock[] {
  const legByPair = new Map(legs.map((leg) => [legKey(leg.fromReservationId, leg.toReservationId), leg]))

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

    const leg = legByPair.get(legKey(from.id, to.id))
    // No leg means the pair shares a location or isn't geocoded yet —
    // buildTripLegs only emits legs that need an actual lookup, so no
    // travel time is required here. A leg with a null duration means the
    // lookup ran but came back unusable (e.g. an unparseable route) — that's
    // "unknown", not "zero", so skip rather than guess and overstate free time.
    if (leg && leg.durationSeconds === null) continue
    const travelSeconds = leg?.durationSeconds ?? 0

    blocks.push({
      fromReservationId: from.id,
      toReservationId: to.id,
      start: fromEnd,
      end: new Date(Date.parse(to.start_at) - travelSeconds * 1000).toISOString(),
      durationSeconds: gapMs / 1000 - travelSeconds,
      travelSeconds,
      tooLongTravel: travelSeconds >= maxTravelSeconds,
      mode: leg?.mode ?? 'DRIVE',
    })
  }

  return blocks
}

export interface DayEdgeFreeBlock {
  /** Local calendar date this block belongs to (the `groupByDate` dateKey). */
  dateKey: string
  position: 'leading' | 'trailing' | 'full-day'
  /** UTC ISO string. */
  start: string
  /** UTC ISO string. */
  end: string
  durationSeconds: number
}

/**
 * TABI-4: a day's free time isn't just the gaps *between* reservations — it
 * defaults to the trip's whole day range (`dayStartTime`→`dayEndTime`, e.g.
 * 08:00→22:00) and subdivides from there. This fills in the two edges
 * `computeFreeTimeBlocks` can't: before a day's first reservation, after its
 * last, and the entire range when a day has nothing booked at all. It
 * deliberately doesn't subtract travel time at these edges — unlike a gap
 * between two known reservations, there's no next destination yet to travel
 * to, so the whole edge is free.
 */
export function computeDayEdgeFreeBlocks(
  days: { dateKey: string; timezone: string; items: (Reservation & { start_at: string })[] }[],
  dayStartTime: string,
  dayEndTime: string,
): DayEdgeFreeBlock[] {
  const blocks: DayEdgeFreeBlock[] = []

  for (const day of days) {
    const dayStart = zonedTimeToUtc(day.dateKey, dayStartTime, day.timezone)
    const dayEnd = zonedTimeToUtc(day.dateKey, dayEndTime, day.timezone)

    if (day.items.length === 0) {
      pushDayEdgeBlock(blocks, day.dateKey, 'full-day', dayStart, dayEnd)
      continue
    }

    const sorted = [...day.items].sort((a, b) => a.start_at.localeCompare(b.start_at))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]

    pushDayEdgeBlock(blocks, day.dateKey, 'leading', dayStart, first.start_at)
    pushDayEdgeBlock(blocks, day.dateKey, 'trailing', last.end_at ?? last.start_at, dayEnd)
  }

  return blocks
}

function pushDayEdgeBlock(
  blocks: DayEdgeFreeBlock[],
  dateKey: string,
  position: DayEdgeFreeBlock['position'],
  start: string,
  end: string,
) {
  const durationSeconds = (Date.parse(end) - Date.parse(start)) / 1000
  if (durationSeconds < MIN_FREE_SECONDS_TO_SHOW) return
  blocks.push({ dateKey, position, start, end, durationSeconds })
}
