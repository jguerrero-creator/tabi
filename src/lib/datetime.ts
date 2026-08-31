export function formatInZone(isoUtc: string, timeZone: string | null): string {
  const date = new Date(isoUtc)
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: timeZone ?? 'UTC',
  }).format(date)
}

export function formatTimeInZone(isoUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: timeZone ?? 'UTC',
  }).format(new Date(isoUtc))
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function localDateKey(isoUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoUtc))
}

/** "HH:MM" 24-hour value for a controlled `<input type="time">`, mirroring `localDateKey`'s date counterpart. */
export function localTimeKey(isoUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone ?? 'UTC',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoUtc))
}

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/**
 * Local day-of-week index (0=Sunday..6=Saturday, matching `Date.getDay()` and
 * Google Places' `regularOpeningHours.periods[].open.day` convention) for a UTC
 * instant observed in `timeZone` — TABI-89's opening-hours check needs this to
 * compare a planned Activity's local weekday against a place's regular hours.
 */
export function localWeekdayIndex(isoUtc: string, timeZone: string | null): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: timeZone ?? 'UTC', weekday: 'short' }).format(
    new Date(isoUtc),
  )
  return WEEKDAY_SHORT_TO_INDEX[short]
}

export function formatDateHeader(isoUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timeZone ?? 'UTC',
  }).format(new Date(isoUtc))
}

/** Short "Mon D" label for a day-tab pill, from a `groupByDate` dateKey (already a resolved local calendar date — no further timezone conversion needed). */
export function formatDayPillLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}

/**
 * "Mon, Jul 20 → Wed, Jul 22" label for a plain calendar-date range (no time/timezone
 * component, e.g. an accommodation gap) — anchors to UTC midnight for the same reason as
 * `formatDayPillLabel`.
 */
export function formatDateRangeLabel(startDate: string, endDate: string): string {
  const format = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number)
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)))
  }
  return `${format(startDate)} → ${format(endDate)}`
}

/** "HH:MM" from a DB `time` column value (already 24h, no timezone conversion needed). */
export function formatTimeOnly(dbTime: string): string {
  return dbTime.slice(0, 5)
}

/**
 * "Dec 6 → Dec 20 · 14 days" header label for a trip's overall date range.
 * `start_date`/`end_date` are plain calendar dates (no time/timezone
 * component), so formatting anchors to UTC noon to avoid any local-machine
 * timezone shifting the displayed day — same reasoning as `formatDayPillLabel`.
 */
export function formatTripDateRange(startDate: string | null, endDate: string | null): string | null {
  if (!startDate || !endDate) return null

  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  const format = (date: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)

  return `${format(start)} → ${format(end)} · ${days} day${days === 1 ? '' : 's'}`
}

/**
 * "Japan Standard Time (UTC+9)" style label for a timezone banner. Derived
 * entirely from ICU's timezone database via Intl — never a hardcoded
 * IANA-id-to-country lookup table, per the country-agnostic architecture rule.
 */
export function formatLocalTimeZoneLabel(isoUtc: string, timeZone: string): string {
  const date = new Date(isoUtc)
  const longName =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  return `${longName} (${offset.replace('GMT', 'UTC')})`
}

/**
 * Converts a wall-clock date + time as observed in `timeZone` into a UTC ISO string.
 * Two-pass offset resolution so DST transitions on the given day resolve correctly.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)

  let utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = timeZoneOffsetMinutes(new Date(utcGuess), timeZone)
    utcGuess = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000
  }
  return new Date(utcGuess).toISOString()
}

/**
 * Whether a real UTC-instant range `[startAt, endAt]` (inclusive) touches the
 * calendar day `dateKey` (a plain "YYYY-MM-DD" string, UTC-midnight-anchored
 * — same convention as `addDays`/`formatDayPillLabel`/`formatDateRangeLabel`
 * elsewhere for date-only values with no inherent timezone of their own).
 * Always compares real UTC instants — never two local calendar-date strings
 * computed in different IANA timezones against each other, which is invalid
 * and can silently invert an otherwise-correct date range (Bugs DB, Majeur —
 * "findActiveVehicleRental inverse sa propre plage de dates à travers des
 * fuseaux horaires éloignés"; Mineur — "lastKnownTripLocation peut se
 * tromper d'ordre chronologique entre fuseaux horaires").
 */
export function dateKeyOverlapsRange(dateKey: string, startAt: string, endAt: string): boolean {
  const dayStart = Date.parse(`${dateKey}T00:00:00.000Z`)
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  return Date.parse(startAt) < dayEnd && Date.parse(endAt) >= dayStart
}

/**
 * Adds an hours/minutes duration to a "HH:MM" wall-clock time, wrapping within the same
 * day (TABI-181: an Activity never spans multiple calendar days, so this never rolls the
 * date over — a wraparound past midnight instead surfaces as an end-before-start validation
 * error, since the wrapped time now sits earlier than the start time on the same date).
 */
export function addDurationToTime(timeStr: string, hours: number, minutes: number): string {
  const [hour, minute] = timeStr.split(':').map(Number)
  const total = (hour * 60 + minute + hours * 60 + minutes) % (24 * 60)
  const endHour = Math.floor(total / 60)
  const endMinute = total % 60
  return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`
}

/** Elapsed hours/minutes between two UTC ISO timestamps, for seeding a duration field from a stored start/end. */
export function durationHoursMinutes(startIso: string, endIso: string): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000))
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}

/**
 * Absolute difference in hours between two IANA timezones' UTC offsets, each
 * evaluated at its own instant (so DST on either side of the leg resolves
 * correctly) — used by the TABI-66 "probable jetlag" day-tab indicator.
 * Purely informational: never feed this into `freeTimeBlocks.ts`.
 */
export function timeZoneOffsetDiffHours(
  startAt: string,
  startTimeZone: string,
  endAt: string,
  endTimeZone: string,
): number {
  const startOffset = timeZoneOffsetMinutes(new Date(startAt), startTimeZone)
  const endOffset = timeZoneOffsetMinutes(new Date(endAt), endTimeZone)
  return Math.abs(endOffset - startOffset) / 60
}

function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)

  const lookup: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value
  }

  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  )
  return (asUtc - date.getTime()) / 60_000
}
