import { Fragment, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { groupByDate } from '../../components/menu/groupByDate'
import { nestOverlappingReservations } from '../../components/menu/nestOverlaps'
import { Spinner } from '../../components/ui/Spinner'
import { useTrip } from '../trips/useTrip'
import { AddReservationModal } from '../reservations/AddReservationModal'
import { useCreateReservation } from '../reservations/useCreateReservation'
import { useReservationsByType } from '../reservations/useReservationsByType'
import { strings } from '../../lib/strings'
import { formatDateHeader, localDateKey } from '../../lib/datetime'
import type { Reservation } from '../../types/reservation'

export function TransportMenuScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
    refetch: refetchReservations,
  } = useReservationsByType(tripId ?? '', 'transport')
  const { createReservation } = useCreateReservation(tripId ?? '')
  const [showAddModal, setShowAddModal] = useState(false)

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError

  const { nestedIds, childrenByMainId } = useMemo(() => nestOverlappingReservations(reservations), [reservations])
  const groups = useMemo(
    () =>
      groupByDate(
        reservations.filter((reservation) => !nestedIds.has(reservation.id)),
        (reservation) => ({
          at: reservation.start_at,
          timezone: reservation.start_timezone,
        }),
      ),
    [reservations, nestedIds],
  )

  return (
    <>
      <MenuHeader
        title={strings.transportMenu.title}
        subtitle={trip?.name}
        count={reservations.length}
        addLabel={strings.transportMenu.addCta}
        onAdd={() => setShowAddModal(true)}
      />

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.transportMenu.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.transportMenu.errorLoading}</p>
        )}

        {!loading && !error && groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.transportMenu.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.transportMenu.emptyBody}</p>
          </div>
        )}

        {!loading && !error && groups.length > 0 && (
          <div className="space-y-5">
            {groups.map((group) => (
              <MenuSection key={group.dateKey} label={group.label}>
                {group.items.map((reservation) => (
                  <Fragment key={reservation.id}>
                    <MenuListRow
                      to={`/reservations/${reservation.id}`}
                      type={reservation.type}
                      title={reservation.name}
                      status={reservation.status}
                      secondaryLabel={arrivalLabel(reservation)}
                    />
                    {(childrenByMainId.get(reservation.id) ?? []).map((nested) => (
                      <MenuListRow
                        key={nested.id}
                        to={`/reservations/${nested.id}`}
                        type={nested.type}
                        title={nested.name}
                        status={nested.status}
                        secondaryLabel={arrivalLabel(nested)}
                        nested
                        overlapBadge={strings.common.overlapBadge}
                      />
                    ))}
                  </Fragment>
                ))}
              </MenuSection>
            ))}
          </div>
        )}
      </main>

      {showAddModal && (
        <AddReservationModal
          tripId={tripId ?? ''}
          defaultType="transport"
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

function arrivalLabel(reservation: Reservation): string | null {
  if (!reservation.start_at || !reservation.end_at) return null
  const departureDate = localDateKey(reservation.start_at, reservation.start_timezone)
  const arrivalDate = localDateKey(reservation.end_at, reservation.end_timezone)
  if (departureDate === arrivalDate) return null
  return `→ ${formatDateHeader(reservation.end_at, reservation.end_timezone)}`
}
