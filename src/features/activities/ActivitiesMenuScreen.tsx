import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { groupByDate } from '../../components/menu/groupByDate'
import { Spinner } from '../../components/ui/Spinner'
import { useTrip } from '../trips/useTrip'
import { AddReservationModal } from '../reservations/AddReservationModal'
import { useCreateReservation } from '../reservations/useCreateReservation'
import { useReservationsByType } from '../reservations/useReservationsByType'
import { strings } from '../../lib/strings'
import { formatDateHeader, localDateKey } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'

export function ActivitiesMenuScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
    refetch: refetchReservations,
  } = useReservationsByType(tripId ?? '', 'activity')
  const { createReservation } = useCreateReservation(tripId ?? '')
  const [showAddModal, setShowAddModal] = useState(false)

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError

  const groups = useMemo(
    () =>
      groupByDate(
        reservations,
        (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
        { unscheduledLabel: strings.activitiesMenu.unscheduledLabel },
      ),
    [reservations],
  )

  return (
    <>
      <MenuHeader
        title={strings.activitiesMenu.title}
        subtitle={trip?.name}
        count={reservations.length}
        addLabel={strings.activitiesMenu.addCta}
        onAdd={() => setShowAddModal(true)}
      />

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.activitiesMenu.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.activitiesMenu.errorLoading}</p>
        )}

        {!loading && !error && groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.activitiesMenu.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.activitiesMenu.emptyBody}</p>
          </div>
        )}

        {!loading && !error && groups.length > 0 && (
          <div className="space-y-5">
            {groups.map((group) => (
              <MenuSection key={group.dateKey} label={group.label}>
                {group.items.map((reservation) => (
                  <MenuListRow
                    key={reservation.id}
                    to={`/reservations/${reservation.id}`}
                    type={reservation.type}
                    title={reservation.name}
                    status={reservation.status}
                    secondaryLabel={endLabel(reservation)}
                  />
                ))}
              </MenuSection>
            ))}
          </div>
        )}
      </main>

      {showAddModal && (
        <AddReservationModal
          defaultType="activity"
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

function endLabel(reservation: Reservation): string | null {
  if (!reservation.start_at || !reservation.end_at) return null
  const startDate = localDateKey(reservation.start_at, reservation.start_timezone)
  const endDate = localDateKey(reservation.end_at, reservation.end_timezone)
  if (startDate === endDate) return null
  return `→ ${formatDateHeader(reservation.end_at, reservation.end_timezone)}`
}
