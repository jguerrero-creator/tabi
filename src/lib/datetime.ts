export function formatInZone(isoUtc: string, timeZone: string | null): string {
  const date = new Date(isoUtc)
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeZone ?? 'UTC',
  }).format(date)
}
