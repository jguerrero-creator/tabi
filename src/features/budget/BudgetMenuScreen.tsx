import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuSection } from '../../components/menu/MenuSection'
import { ReservationTypeIcon } from '../../components/ui/ReservationTypeIcon'
import { Spinner } from '../../components/ui/Spinner'
import { formatCurrency } from '../../lib/currency'
import { strings } from '../../lib/strings'
import { useTrip } from '../trips/useTrip'
import { useTripReservations } from '../trips/useTripReservations'
import { computeBudgetSummary } from './computeBudgetSummary'

export function BudgetMenuScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
  } = useTripReservations(tripId ?? '')

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError
  const summary = useMemo(() => computeBudgetSummary(reservations), [reservations])
  const currency = trip?.currency ?? ''

  return (
    <>
      <MenuHeader title={strings.menus.budget} subtitle={trip?.name} />

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.budgetMenu.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.budgetMenu.errorLoading}</p>
        )}

        {!loading && !error && summary.count === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.budgetMenu.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.budgetMenu.emptyBody}</p>
          </div>
        )}

        {!loading && !error && summary.count > 0 && (
          <div className="space-y-5">
            <section className="rounded-xl bg-teal-700 px-4 py-5 text-white">
              <p className="text-xs font-medium uppercase tracking-wide text-teal-100">
                {strings.budgetMenu.totalLabel}
              </p>
              <p className="mt-1 text-3xl font-semibold">{formatCurrency(summary.total, currency)}</p>
              {summary.pricedCount < summary.count && (
                <p className="mt-1 text-xs text-teal-100">
                  {strings.budgetMenu.partialHint(summary.pricedCount, summary.count)}
                </p>
              )}
            </section>

            <MenuSection label={strings.budgetMenu.byCategoryLabel}>
              {summary.categories
                .filter((category) => category.count > 0)
                .map((category) => (
                  <li key={category.type} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                      <ReservationTypeIcon type={category.type} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {strings.reservationType[category.type]}
                      </p>
                      <p className="text-xs text-slate-500">{strings.budgetMenu.itemCount(category.count)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-slate-900">
                      {formatCurrency(category.total, currency)}
                    </p>
                  </li>
                ))}
            </MenuSection>
          </div>
        )}
      </main>
    </>
  )
}
