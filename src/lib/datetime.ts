export function formatInZone(isoUtc: string, timeZone: string | null): string {
  const date = new Date(isoUtc)
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeZone ?? 'UTC',
  }).format(date)
}

export function formatTimeInZone(isoUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    timeStyle: 'short',
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
