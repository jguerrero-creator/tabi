import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { groupByDate } from '../../components/menu/groupByDate'
import { Spinner } from '../../components/ui/Spinner'
import { formatCurrency } from '../../lib/currency'
import { strings } from '../../lib/strings'
import { useReservationsByType } from '../reservations/useReservationsByType'
import { useTrip } from '../trips/useTrip'
import type { Reservation, ReservationType } from '../../types/reservation'

const VALID_TYPES: ReservationType[] = ['stay', 'transport', 'activity']

export function BudgetCategoryDetailScreen() {
  const { tripId, type } = useParams<{ tripId: string; type: string }>()

  if (!type || !VALID_TYPES.includes(type as ReservationType)) {
    return <Navigate to={`/trips/${tripId}/budget`} replace />
  }

  return <BudgetCategoryDetailScreenInner tripId={tripId ?? ''} type={type as ReservationType} />
}

function BudgetCategoryDetailScreenInner({ tripId, type }: { tripId: string; type: ReservationType }) {
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId)
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
  } = useReservationsByType(tripId, type)

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError
  const currency = trip?.currency ?? ''
  const travelerCount = trip?.traveler_count ?? 1

  const groups = useMemo(
    () =>
      groupByDate(
        reservations,
        (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
        { unscheduledLabel: strings.budgetCategoryDetail.unscheduledLabel },
      ),
    [reservations],
  )

  function costLabel(reservation: Reservation): React.ReactNode {
    if (reservation.price_amount == null) {
      return <span className="text-xs text-slate-400">{strings.budgetMenu.noPriceEntered}</span>
    }
    const amount = formatCurrency(reservation.price_amount, reservation.price_currency ?? currency)
    if (type !== 'stay' || travelerCount <= 1) {
      return <span className="text-sm font-semibold text-slate-900">{amount}</span>
    }
    const perPerson = formatCurrency(reservation.price_amount / travelerCount, reservation.price_currency ?? currency)
    return (
      <span className="text-sm font-semibold text-slate-900">
        {amount}
        <span className="ml-1 font-normal text-slate-500">· {strings.budgetMenu.perPersonAmount(perPerson)}</span>
      </span>
    )
  }

  return (
    <>
      <MenuHeader title={strings.reservationType[type]} subtitle={trip?.name} count={reservations.length} />

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.budgetCategoryDetail.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.budgetCategoryDetail.errorLoading}</p>
        )}

        {!loading && !error && reservations.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.budgetCategoryDetail.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.budgetCategoryDetail.emptyBody}</p>
          </div>
        )}

        {!loading && !error && reservations.length > 0 && (
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
                    staySubtype={reservation.stay_subtype}
                    transportSubtype={reservation.transport_subtype}
                    trailing={costLabel(reservation)}
                  />
                ))}
              </MenuSection>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
