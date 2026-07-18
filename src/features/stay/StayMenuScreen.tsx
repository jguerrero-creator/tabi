import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { groupByDate, type DateGroup } from '../../components/menu/groupByDate'
import { Spinner } from '../../components/ui/Spinner'
import { useTrip } from '../trips/useTrip'
import { AddReservationModal } from '../reservations/AddReservationModal'
import { useCreateReservation } from '../reservations/useCreateReservation'
import { useReservationsByType } from '../reservations/useReservationsByType'
import { strings } from '../../lib/strings'
import { formatDateHeader, localDateKey } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'
import { computeAccommodationGaps, type AccommodationGap } from './computeAccommodationGaps'

type TimelineEntry =
  | { kind: 'group'; sortKey: string; group: DateGroup<Reservation> }
  | { kind: 'gap'; sortKey: string; gap: AccommodationGap }

export function StayMenuScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
    refetch: refetchReservations,
  } = useReservationsByType(tripId ?? '', 'stay')
  const { createReservation } = useCreateReservation(tripId ?? '')
  const [showAddModal, setShowAddModal] = useState(false)

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError

  const gaps = useMemo(() => {
    if (!trip) return []
    return computeAccommodationGaps(trip, reservations)
  }, [trip, reservations])

  const timeline = useMemo(() => buildTimeline(reservations, gaps), [reservations, gaps])

  return (
    <>
      <MenuHeader
        title={strings.stayMenu.title}
        subtitle={trip?.name}
        count={reservations.length}
        addLabel={strings.stayMenu.addCta}
        onAdd={() => setShowAddModal(true)}
      />

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
          <div className="space-y-5">
            {timeline.map((entry) =>
              entry.kind === 'group' ? (
                <MenuSection key={entry.sortKey} label={entry.group.label}>
                  {entry.group.items.map((reservation) => (
                    <MenuListRow
                      key={reservation.id}
                      to={`/reservations/${reservation.id}`}
                      type={reservation.type}
                      title={reservation.name}
                      status={reservation.status}
                      secondaryLabel={checkoutLabel(reservation)}
                    />
                  ))}
                </MenuSection>
              ) : (
                <GapSection key={entry.sortKey} gap={entry.gap} />
              ),
            )}
          </div>
        )}
      </main>

      {showAddModal && (
        <AddReservationModal
          tripId={tripId ?? ''}
          defaultType="hotel"
          onClose={() => setShowAddModal(false)}
          onCreate={async (input) => {
            const created = await createReservation(input)
            await refetchReservations()
            return created
          }}
        />
      )}
    </>
  )
}

function GapSection({ gap }: { gap: AccommodationGap }) {
  const nights = nightsBetween(gap.start, gap.end)
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600">
        {strings.stayMenu.gapLabel} · {gap.start} → {gap.end}
      </h2>
      <div className="flex items-center gap-3 rounded-xl border-l-4 border-l-red-400 bg-red-50 px-4 py-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
        <p className="text-sm font-medium text-red-700">
          {nights} {nights === 1 ? 'night' : 'nights'} not booked
        </p>
      </div>
    </section>
  )
}

function checkoutLabel(reservation: Reservation): string | null {
  if (!reservation.end_at) return null
  // Stay reservations always have start_at (DB constraint: only activities may leave it null).
  const checkIn = localDateKey(reservation.start_at!, reservation.start_timezone)
  const checkOut = localDateKey(reservation.end_at, reservation.end_timezone)
  if (checkIn === checkOut) return null
  return `→ ${formatDateHeader(reservation.end_at, reservation.end_timezone)}`
}

function buildTimeline(reservations: Reservation[], gaps: AccommodationGap[]): TimelineEntry[] {
  const groups = groupByDate(reservations, (reservation) => ({
    at: reservation.start_at,
    timezone: reservation.start_timezone,
  }))

  const entries: TimelineEntry[] = [
    ...groups.map((group): TimelineEntry => ({ kind: 'group', sortKey: group.dateKey, group })),
    ...gaps.map((gap): TimelineEntry => ({ kind: 'gap', sortKey: gap.start, gap })),
  ]
  return entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}

function nightsBetween(start: string, end: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / msPerDay)
}
