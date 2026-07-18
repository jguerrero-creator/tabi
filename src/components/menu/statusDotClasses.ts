import type { ReservationStatus } from '../../types/reservation'

export const statusDotClasses: Record<ReservationStatus, string> = {
  booked: 'bg-emerald-500',
  to_book: 'bg-amber-500',
  decide_later: 'bg-slate-400',
}
