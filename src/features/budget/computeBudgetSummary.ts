import type { BudgetCategory } from '../../types/budgetCategory'
import type { Reservation, ReservationType } from '../../types/reservation'

export interface BudgetCategoryTotal {
  type: ReservationType
  total: number
  count: number
  pricedCount: number
}

export interface BudgetSummary {
  categories: BudgetCategoryTotal[]
  manualTotal: number
  total: number
  count: number
  pricedCount: number
}

const categoryOrder: ReservationType[] = ['stay', 'transport', 'activity']

export function computeBudgetSummary(
  reservations: Reservation[],
  budgetCategories: BudgetCategory[] = [],
): BudgetSummary {
  const categories = categoryOrder.map((type): BudgetCategoryTotal => {
    const items = reservations.filter((reservation) => reservation.type === type)
    const priced = items.filter((reservation) => reservation.price_amount != null)
    return {
      type,
      total: priced.reduce((sum, reservation) => sum + reservation.price_amount!, 0),
      count: items.length,
      pricedCount: priced.length,
    }
  })

  const manualTotal = budgetCategories.reduce((sum, category) => sum + category.amount, 0)
  const reservationsTotal = categories.reduce((sum, category) => sum + category.total, 0)

  return {
    categories,
    manualTotal,
    total: reservationsTotal + manualTotal,
    count: reservations.length,
    pricedCount: categories.reduce((sum, category) => sum + category.pricedCount, 0),
  }
}
