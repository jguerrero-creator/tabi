import type { ReservationStatus } from '../types/reservation'

/**
 * Hex equivalents of statusDotClasses' Tailwind colors (emerald-500 / amber-500
 * / slate-400), for contexts like Google Maps Polyline/Symbol styling where a
 * CSS class can't be applied — must stay in sync with statusDotClasses.ts's
 * palette rather than inventing a separate one (CLAUDE.md rule #18).
 */
export const statusHexColors: Record<ReservationStatus, string> = {
  booked: '#10b981',
  to_book: '#f59e0b',
  decide_later: '#94a3b8',
}

/** A day-level planned location has no booking status of its own; render it
 * with the same neutral tone as `decide_later` rather than a new color. */
export const noStatusHexColor = statusHexColors.decide_later

export function mapStatusColor(status: ReservationStatus | null): string {
  return status ? statusHexColors[status] : noStatusHexColor
}
