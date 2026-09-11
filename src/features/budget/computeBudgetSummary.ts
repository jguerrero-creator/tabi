import { logClientError } from '../../lib/logError'
import type { BudgetCategory } from '../../types/budgetCategory'
import type { Reservation, ReservationType } from '../../types/reservation'

export interface BudgetCategoryTotal {
  type: ReservationType
  total: number
  count: number
  pricedCount: number
  /** Stay total ÷ traveler count — a shared room, unlike Transport/Activity which are booked per-person. Null unless there's more than 1 traveler. */
  perPersonTotal: number | null
}

export interface BudgetSummary {
  categories: BudgetCategoryTotal[]
  manualTotal: number
  total: number
  /** Grand total with Stay divided by traveler count (Transport/Activity/manual stay full price). Null unless there's more than 1 traveler. */
  totalPerPerson: number | null
  count: number
  pricedCount: number
}

const categoryOrder: ReservationType[] = ['stay', 'transport', 'activity']

export function computeBudgetSummary(
  reservations: Reservation[],
  budgetCategories: BudgetCategory[] = [],
  travelerCount = 1,
  tripCurrency?: string,
): BudgetSummary {
  const categories = categoryOrder.map((type): BudgetCategoryTotal => {
    const items = reservations.filter((reservation) => reservation.type === type)
    const priced = items.filter((reservation) => reservation.price_amount != null)
    // Summary math assumes single-currency reservations (price_currency is force-set to
    // trip.currency at save time). Guard it anyway so a future save-path change can't
    // silently mis-sum mixed currencies.
    const summable = priced.filter((reservation) => {
      const mismatched = tripCurrency != null && reservation.price_currency !== tripCurrency
      if (mismatched) {
        logClientError(
          'computeBudgetSummary',
          new Error(
            `Reservation ${reservation.id} has price_currency "${reservation.price_currency}", expected trip currency "${tripCurrency}" — excluded from budget total`,
          ),
        )
      }
      return !mismatched
    })
    const total = summable.reduce((sum, reservation) => sum + reservation.price_amount!, 0)
    return {
      type,
      total,
      count: items.length,
      pricedCount: priced.length,
      perPersonTotal: type === 'stay' && travelerCount > 1 ? total / travelerCount : null,
    }
  })

  const manualTotal = budgetCategories.reduce((sum, category) => sum + category.amount, 0)
  const reservationsTotal = categories.reduce((sum, category) => sum + category.total, 0)
  const reservationsTotalPerPerson = categories.reduce(
    (sum, category) => sum + (category.perPersonTotal ?? category.total),
    0,
  )

  return {
    categories,
    manualTotal,
    total: reservationsTotal + manualTotal,
    totalPerPerson: travelerCount > 1 ? reservationsTotalPerPerson + manualTotal : null,
    count: reservations.length,
    pricedCount: categories.reduce((sum, category) => sum + category.pricedCount, 0),
  }
}
