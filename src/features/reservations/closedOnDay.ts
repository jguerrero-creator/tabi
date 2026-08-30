import { localTimeKey, localWeekdayIndex } from '../../lib/datetime'
import type { RegularOpeningHours } from '../../lib/placeOpeningHours'

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export interface ClosedAlert {
  weekdayIndex: number
}

/**
 * TABI-89: compares a planned Activity's local date/time against the attached
 * place's real Google Places regular opening hours (Decision Log, 2026-07-16 —
 * no AI/generative guessing here). Returns null whenever there's nothing
 * confirmed to say: no cached hours, no periods data (absence of data is never
 * treated as "closed"), or no planned date/time yet. Handles multiple periods
 * per day (e.g. a lunch closure) and overnight-wrapping periods (close.day
 * different from open.day).
 */
export function checkClosedAtPlannedTime(
  openingHours: RegularOpeningHours | null | undefined,
  startAt: string | null,
  timeZone: string | null,
): ClosedAlert | null {
  if (!openingHours || openingHours.periods.length === 0) return null
  if (!startAt || !timeZone) return null

  const weekdayIndex = localWeekdayIndex(startAt, timeZone)
  const [hour, minute] = localTimeKey(startAt, timeZone).split(':').map(Number)
  const targetMinutes = weekdayIndex * 1440 + hour * 60 + minute

  const isOpen = openingHours.periods.some((period) => {
    const openMinutes = period.open.day * 1440 + period.open.hour * 60 + period.open.minute
    if (!period.close) {
      // No close time at all for this period means the place is open 24 hours that day.
      return openMinutes <= targetMinutes && targetMinutes < openMinutes + 1440
    }
    let closeMinutes = period.close.day * 1440 + period.close.hour * 60 + period.close.minute
    if (closeMinutes <= openMinutes) closeMinutes += 7 * 1440

    for (const offset of [0, -7 * 1440, 7 * 1440]) {
      const shifted = targetMinutes + offset
      if (openMinutes <= shifted && shifted < closeMinutes) return true
    }
    return false
  })

  return isOpen ? null : { weekdayIndex }
}
