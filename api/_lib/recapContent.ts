// Server-side only — builds tomorrow's recap content for one trip, reusing
// the same free-time-block model TripTimeline shows on screen. See
// ../send-daily-recap.ts.
import { buildDayOccurrences, type DayOccurrence } from '../../src/lib/dayOccurrences.js'
import { localDateKey } from '../../src/lib/datetime.js'
import {
  computeDayEdgeFreeBlocks,
  computeFreeTimeBlocks,
  type DayEdgeFreeBlock,
  type FreeTimeBlock,
} from '../../src/lib/freeTimeBlocks.js'
import type { TripDayLocation } from '../../src/types/dayLocation'
import type { Reservation } from '../../src/types/reservation'
import type { Trip } from '../../src/types/trip'

export interface RecapContent {
  tripName: string
  dateKey: string
  timezone: string
  items: (DayOccurrence & { start_at: string })[]
  freeBlocks: FreeTimeBlock[]
  dayEdges: DayEdgeFreeBlock[]
}

/**
 * Builds tomorrow's recap content for one trip. Travel-time-aware free
 * blocks depend on a per-leg transport mode the user has chosen (TABI-154) —
 * that choice only ever lives in ephemeral client state (`OverviewScreen`'s
 * `modeByLeg`), never persisted to the database, so there is nothing for a
 * server-side job to look up. Every leg is treated as "no mode chosen yet"
 * (an empty `legs` array), which `computeFreeTimeBlocks` already renders
 * correctly as a plain, un-subtracted free block — the same thing a user
 * would see on first load, before picking any travel mode themselves.
 */
export function buildRecapContent(
  trip: Trip,
  reservations: Reservation[],
  dayLocations: TripDayLocation[],
  referenceDateUtc: Date = new Date(),
): RecapContent {
  const timezone = resolveTomorrowTimezone(dayLocations, referenceDateUtc)
  const dateKey = tomorrowDateKey(referenceDateUtc, timezone)

  const items = buildDayOccurrences(reservations).filter(
    (item): item is DayOccurrence & { start_at: string } =>
      item.start_at !== null && localDateKey(item.start_at, item.start_timezone ?? timezone) === dateKey,
  )

  const freeBlocks = computeFreeTimeBlocks(items, [])
  const dayEdges = computeDayEdgeFreeBlocks([{ dateKey, timezone, items }], trip.day_start_time, trip.day_end_time)

  return { tripName: trip.name, dateKey, timezone, items, freeBlocks, dayEdges }
}

// A day-location's own `date` is a plain calendar key, independent of any
// timezone math, so it's looked up against a UTC-based guess at "tomorrow"
// first. A trip whose local day genuinely straddles a UTC date boundary
// could in principle miss the exact row here — an accepted imprecision, same
// as the once-daily (Hobby-plan) cron schedule itself already accepts not
// hitting each trip's exact local evening.
function resolveTomorrowTimezone(dayLocations: TripDayLocation[], referenceDateUtc: Date): string {
  const utcTomorrow = addUtcDays(referenceDateUtc, 1).toISOString().slice(0, 10)
  return dayLocations.find((location) => location.date === utcTomorrow)?.timezone ?? 'UTC'
}

function tomorrowDateKey(referenceDateUtc: Date, timezone: string): string {
  return localDateKey(addUtcDays(referenceDateUtc, 1).toISOString(), timezone)
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}
