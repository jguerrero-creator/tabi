export function formatInZone(isoUtc: string, timeZone: string | null): string {
  const date = new Date(isoUtc)
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeZone ?? 'UTC',
  }).format(date)
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

export function formatDateHeader(isoUtc: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timeZone ?? 'UTC',
  }).format(new Date(isoUtc))
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
