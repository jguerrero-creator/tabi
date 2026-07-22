import type { ReservationStatus } from '../../types/reservation'

export const statusDotClasses: Record<ReservationStatus, string> = {
  booked: 'bg-emerald-500',
  to_book: 'bg-amber-500',
  decide_later: 'bg-slate-400',
}

/** Same 3-state palette as statusDotClasses, as a text/stroke color for icons (e.g. the bed icon on day pills, TABI-143). */
export const statusTextClasses: Record<ReservationStatus, string> = {
  booked: 'text-emerald-500',
  to_book: 'text-amber-500',
  decide_later: 'text-slate-400',
}
