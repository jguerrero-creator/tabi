import { useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuSection } from '../../components/menu/MenuSection'
import { Button } from '../../components/ui/Button'
import { ReservationTypeIcon, reservationTypeBadgeClasses } from '../../components/ui/ReservationTypeIcon'
import { Spinner } from '../../components/ui/Spinner'
import { formatCurrency } from '../../lib/currency'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import { useTrip } from '../trips/useTrip'
import { useTripReservations } from '../trips/useTripReservations'
import { BudgetCategoryRow } from './BudgetCategoryRow'
import { computeBudgetSummary } from './computeBudgetSummary'
import { useTripBudgetCategories } from './useTripBudgetCategories'

export function BudgetMenuScreen() {
  const newLabelFieldId = useId()
  const newAmountFieldId = useId()
  const { tripId } = useParams<{ tripId: string }>()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
  } = useTripReservations(tripId ?? '')
  const {
    categories: budgetCategories,
    loading: categoriesLoading,
    error: categoriesError,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useTripBudgetCategories(tripId ?? '')

  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const loading = tripLoading || reservationsLoading || categoriesLoading
  const error = tripError || reservationsError || categoriesError
  const summary = useMemo(
    () => computeBudgetSummary(reservations, budgetCategories, trip?.traveler_count ?? 1),
    [reservations, budgetCategories, trip?.traveler_count],
  )
  const currency = trip?.currency ?? ''
  const isEmpty = summary.count === 0 && budgetCategories.length === 0

  async function handleAddCategory(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = newLabel.trim()
    const parsedAmount = Number(newAmount)
    if (!trimmedLabel || !Number.isFinite(parsedAmount)) return
    setSubmitting(true)
    setAddError(null)
    try {
      await createCategory({ label: trimmedLabel, amount: parsedAmount })
      setNewLabel('')
      setNewAmount('')
      setAdding(false)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('BudgetMenuScreen.handleAddCategory', err)
      setAddError(strings.budgetMenu.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <MenuHeader
        title={strings.menus.budget}
        subtitle={trip?.name}
        addLabel={strings.budgetMenu.addCta}
        onAdd={() => setAdding(true)}
      />

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

        {!loading && !error && isEmpty && !adding && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.budgetMenu.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.budgetMenu.emptyBody}</p>
          </div>
        )}

        {!loading && !error && (!isEmpty || adding) && (
          <div className="space-y-5">
            {!isEmpty && (
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
            )}

            {summary.count > 0 && (
              <MenuSection label={strings.budgetMenu.byCategoryLabel}>
                {summary.categories
                  .filter((category) => category.count > 0)
                  .map((category) => (
                    <li key={category.type}>
                      <Link
                        to={`/trips/${tripId}/budget/${category.type}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${reservationTypeBadgeClasses[category.type]}`}
                        >
                          <ReservationTypeIcon type={category.type} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {strings.reservationType[category.type]}
                          </p>
                          <p className="text-xs text-slate-500">{strings.budgetMenu.itemCount(category.count)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold text-slate-900">
                            {formatCurrency(category.total, currency)}
                            {category.perPersonTotal != null && (
                              <span className="ml-1 font-normal text-slate-500">
                                · {strings.budgetMenu.perPersonAmount(formatCurrency(category.perPersonTotal, currency))}
                              </span>
                            )}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
              </MenuSection>
            )}

            {(budgetCategories.length > 0 || adding) && (
              <MenuSection label={strings.budgetMenu.manualCategoriesLabel}>
                {adding && (
                  <li className="px-4 py-3">
                    <form onSubmit={handleAddCategory} className="space-y-2">
                      <input
                        id={newLabelFieldId}
                        name={newLabelFieldId}
                        value={newLabel}
                        onChange={(event) => setNewLabel(event.target.value)}
                        placeholder={strings.budgetMenu.labelPlaceholder}
                        required
                        autoFocus
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                      />
                      <input
                        id={newAmountFieldId}
                        name={newAmountFieldId}
                        type="number"
                        step="0.01"
                        min="0"
                        value={newAmount}
                        onChange={(event) => setNewAmount(event.target.value)}
                        placeholder={strings.budgetMenu.amountPlaceholder}
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                      />
                      {addError && <p className="text-xs text-red-600">{addError}</p>}
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setAdding(false)}
                          disabled={submitting}
                        >
                          {strings.budgetMenu.cancel}
                        </Button>
                        <Button type="submit" disabled={submitting}>
                          {strings.budgetMenu.save}
                        </Button>
                      </div>
                    </form>
                  </li>
                )}
                {budgetCategories.map((category) => (
                  <BudgetCategoryRow
                    key={category.id}
                    category={category}
                    currency={currency}
                    onUpdate={updateCategory}
                    onDelete={deleteCategory}
                  />
                ))}
              </MenuSection>
            )}
          </div>
        )}
      </main>
    </>
  )
}
