import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ReservationTypeIcon } from '../../components/ui/ReservationTypeIcon'
import { Spinner } from '../../components/ui/Spinner'
import { useTrip } from '../trips/useTrip'
import { useReservationsByType } from '../reservations/useReservationsByType'
import { strings } from '../../lib/strings'
import { formatInZone } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'
import { computeAccommodationGaps, type AccommodationGap } from './computeAccommodationGaps'

type TimelineEntry =
  | { kind: 'stay'; sortKey: string; reservation: Reservation }
  | { kind: 'gap'; sortKey: string; gap: AccommodationGap }

const statusDotClasses: Record<Reservation['status'], string> = {
  booked: 'bg-emerald-500',
  to_book: 'bg-amber-500',
  decide_later: 'bg-slate-400',
}

export function StayMenuScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
  } = useReservationsByType(tripId ?? '', 'stay')

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError

  const gaps = useMemo(() => {
    if (!trip) return []
    return computeAccommodationGaps(trip, reservations)
  }, [trip, reservations])

  const timeline = useMemo(() => buildTimeline(reservations, gaps), [reservations, gaps])

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={strings.common.back}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          ←
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{strings.stayMenu.title}</h1>
          {trip && <p className="text-xs text-slate-500">{trip.name}</p>}
        </div>
      </header>

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.stayMenu.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.stayMenu.errorLoading}</p>
        )}

        {!loading && !error && trip && !trip.start_date && !trip.end_date && (
          <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
            {strings.stayMenu.setDatesHint}
          </p>
        )}

        {!loading && !error && timeline.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.stayMenu.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.stayMenu.emptyBody}</p>
          </div>
        )}

        {!loading && !error && timeline.length > 0 && (
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {timeline.map((entry) =>
              entry.kind === 'stay' ? (
                <StayRow key={entry.reservation.id} reservation={entry.reservation} />
              ) : (
                <GapRow key={entry.sortKey} gap={entry.gap} />
              ),
            )}
          </ul>
        )}
      </main>
    </div>
  )
}

function StayRow({ reservation }: { reservation: Reservation }) {
  return (
    <li>
      <Link to={`/reservations/${reservation.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
          <ReservationTypeIcon type={reservation.type} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClasses[reservation.status]}`} />
            <span className="truncate">{reservation.name}</span>
          </p>
          <p className="text-xs text-slate-500">
            {formatInZone(reservation.start_at, reservation.start_timezone)}
            {reservation.end_at && ` → ${formatInZone(reservation.end_at, reservation.end_timezone)}`}
          </p>
        </div>
      </Link>
    </li>
  )
}

function GapRow({ gap }: { gap: AccommodationGap }) {
  const nights = nightsBetween(gap.start, gap.end)
  return (
    <li className="flex items-center gap-3 border-l-4 border-l-red-400 bg-red-50 px-4 py-3">
      <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-700">
          {strings.stayMenu.gapLabel} — {nights} {nights === 1 ? 'night' : 'nights'}
        </p>
        <p className="text-xs text-red-600">
          {gap.start} → {gap.end}
        </p>
      </div>
    </li>
  )
}

function buildTimeline(reservations: Reservation[], gaps: AccommodationGap[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...reservations.map((reservation): TimelineEntry => ({
      kind: 'stay',
      sortKey: reservation.start_at,
      reservation,
    })),
    ...gaps.map((gap): TimelineEntry => ({
      kind: 'gap',
      sortKey: `${gap.start}T00:00:00Z`,
      gap,
    })),
  ]
  return entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}

function nightsBetween(start: string, end: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / msPerDay)
}
