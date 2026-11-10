import { logClientError } from '../../lib/logError'
import type { BudgetCategory } from '../../types/budgetCategory'
import type { Reservation, ReservationType } from '../../types/reservation'
import type { SouvenirItem } from '../../types/souvenirItem'

export interface BudgetCategoryTotal {
  type: ReservationType
  total: number
  count: number
  pricedCount: number
  /** Stay total ÷ traveler count — a shared room, unlike Transport/Activity which are booked per-person. Null unless there's more than 1 traveler. */
  perPersonTotal: number | null
}

export interface BudgetSouvenirsTotal {
  total: number
  count: number
  checkedCount: number
}

export interface BudgetOtherTotal {
  total: number
  count: number
  pricedCount: number
}

export interface BudgetSummary {
  categories: BudgetCategoryTotal[]
  /**
   * Reservations whose type isn't in categoryOrder — a future ReservationType the
   * Budget UI hasn't been updated for yet. Always empty today (every real type has a
   * category), but `total`/`pricedCount`/the per-traveler base all fold this in so a
   * forgotten category can never silently vanish from the numbers the way a priced
   * Meal once did before 'meal' was added to categoryOrder.
   */
  other: BudgetOtherTotal
  manualTotal: number
  /** Souvenirs checklist folded into the budget as its own category (TABI merge) — every item counts toward `total`, checked or not, and is never divided by traveler count. */
  souvenirs: BudgetSouvenirsTotal
  total: number
  /** Grand total with Stay divided by traveler count (Transport/Activity/Meal/manual/Souvenirs/Other stay full price). Null unless there's more than 1 traveler. */
  totalPerPerson: number | null
  count: number
  pricedCount: number
}

const categoryOrder: ReservationType[] = ['stay', 'transport', 'activity', 'meal']

/**
 * TABI-263: the ONE place that decides which reservation categories are shared and
 * divided by traveler count vs. counted per person as entered. Today only Stay (a
 * shared room) — everything else is assumed already entered per person. A later
 * ticket ("Prix par personne ou pour tous") may turn this into a per-reservation
 * price_basis setting; when it does, only this function should need to change.
 */
export function isDividedByTravelerCount(type: ReservationType): boolean {
  return type === 'stay'
}

// Summary math assumes single-currency reservations (price_currency is force-set to
// trip.currency at save time). Guard it anyway so a future save-path change can't
// silently mis-sum mixed currencies.
function summarizePriced(
  items: Reservation[],
  tripCurrency: string | undefined,
  logContext: string,
): { total: number; pricedCount: number } {
  const priced = items.filter((reservation) => reservation.price_amount != null)
  const summable = priced.filter((reservation) => {
    const mismatched = tripCurrency != null && reservation.price_currency !== tripCurrency
    if (mismatched) {
      logClientError(
        logContext,
        new Error(
          `Reservation ${reservation.id} has price_currency "${reservation.price_currency}", expected trip currency "${tripCurrency}" — excluded from budget total`,
        ),
      )
    }
    return !mismatched
  })
  return {
    total: summable.reduce((sum, reservation) => sum + reservation.price_amount!, 0),
    pricedCount: priced.length,
  }
}

export function computeBudgetSummary(
  reservations: Reservation[],
  budgetCategories: BudgetCategory[] = [],
  travelerCount = 1,
  tripCurrency?: string,
  souvenirItems: SouvenirItem[] = [],
): BudgetSummary {
  const categories = categoryOrder.map((type): BudgetCategoryTotal => {
    const items = reservations.filter((reservation) => reservation.type === type)
    const { total, pricedCount } = summarizePriced(items, tripCurrency, 'computeBudgetSummary')
    return {
      type,
      total,
      count: items.length,
      pricedCount,
      perPersonTotal: isDividedByTravelerCount(type) && travelerCount > 1 ? total / travelerCount : null,
    }
  })

  // Anything not in categoryOrder (a future type the Budget UI hasn't caught up to
  // yet) still has to be counted, never dropped — tracked separately since it has no
  // real ReservationType to label/icon it as a `categories` entry.
  const categorizedTypes = new Set(categoryOrder)
  const otherItems = reservations.filter((reservation) => !categorizedTypes.has(reservation.type))
  const { total: otherTotal, pricedCount: otherPricedCount } = summarizePriced(
    otherItems,
    tripCurrency,
    'computeBudgetSummary (other)',
  )
  const other: BudgetOtherTotal = { total: otherTotal, count: otherItems.length, pricedCount: otherPricedCount }

  const manualTotal = budgetCategories.reduce((sum, category) => sum + category.amount, 0)
  const reservationsTotal = categories.reduce((sum, category) => sum + category.total, 0) + other.total
  const reservationsTotalPerPerson =
    categories.reduce((sum, category) => sum + (category.perPersonTotal ?? category.total), 0) + other.total

  // Every souvenir counts toward the budget regardless of checked state — it's a
  // planned budget, not a spent-so-far ledger — and an empty amount counts as
  // nothing rather than being coerced to 0 by a default (decisions #4/#6).
  const souvenirsTotal = souvenirItems.reduce((sum, item) => sum + (item.amount ?? 0), 0)
  const souvenirs: BudgetSouvenirsTotal = {
    total: souvenirsTotal,
    count: souvenirItems.length,
    checkedCount: souvenirItems.filter((item) => item.is_checked).length,
  }

  return {
    categories,
    other,
    manualTotal,
    souvenirs,
    total: reservationsTotal + manualTotal + souvenirsTotal,
    // Souvenirs are never split by traveler count (decision #5), unlike Stay.
    totalPerPerson: travelerCount > 1 ? reservationsTotalPerPerson + manualTotal + souvenirsTotal : null,
    count: reservations.length,
    pricedCount: categories.reduce((sum, category) => sum + category.pricedCount, 0) + other.pricedCount,
  }
}
