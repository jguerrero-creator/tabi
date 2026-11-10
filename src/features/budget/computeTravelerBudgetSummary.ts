import { currencyMinorUnitStep } from '../../lib/currency'
import type { SouvenirItem } from '../../types/souvenirItem'
import type { TripTraveler } from '../../types/tripTraveler'
import { isDividedByTravelerCount, type BudgetSummary } from './computeBudgetSummary'

export interface TravelerBudgetTotal {
  travelerId: string
  name: string
  total: number
}

/**
 * TABI-263 Steps C+B'. Per-traveler totals — only meaningful with 2+ NAMED
 * travelers (fewer than that, this returns null and nothing in Budget changes
 * from today's output, by design: the "no change" guarantee).
 *
 * For every named traveler: total = their share of the divided categories (today:
 * Stay/effectiveN, see isDividedByTravelerCount) + every non-divided category and
 * manual budget IN FULL (already entered per person, decision #28/08 confirmed
 * 08/11) + souvenirs assigned to them IN FULL + their equal share of UNASSIGNED
 * souvenirs. Assigning a souvenir therefore moves money between travelers without
 * changing the group total — the sum of every traveler's total (effectiveN of
 * them, including any unnamed "slot") always equals effectiveN × the shared base
 * plus every souvenir's amount, named or not.
 *
 * effectiveN can exceed the number of NAMED travelers (Step A's reconciliation:
 * the stored traveler_count is a floor, names are optional labels on top of it).
 * When that happens, the unnamed slot's share of the divided categories and the
 * unassigned-souvenir pool is still computed (so the math stays correct) but is
 * never displayed — there is no row for a traveler with no name.
 */
export function computeTravelerBudgetSummary(
  summary: BudgetSummary,
  souvenirItems: SouvenirItem[],
  namedTravelers: TripTraveler[],
  storedTravelerCount: number,
  tripCurrency?: string,
): TravelerBudgetTotal[] | null {
  if (namedTravelers.length < 2) return null

  const effectiveN = Math.max(storedTravelerCount, namedTravelers.length)
  const minorUnitStep = currencyMinorUnitStep(tripCurrency ?? '')

  const dividedTotal = summary.categories
    .filter((category) => isDividedByTravelerCount(category.type))
    .reduce((sum, category) => sum + category.total, 0)
  const flatBase =
    summary.categories
      .filter((category) => !isDividedByTravelerCount(category.type))
      .reduce((sum, category) => sum + category.total, 0) + summary.manualTotal

  const dividedShares = splitEqually(dividedTotal, effectiveN, minorUnitStep)

  const assignedByTraveler = new Map<string, number>()
  let unassignedTotal = 0
  for (const item of souvenirItems) {
    const amount = item.amount ?? 0
    if (item.traveler_id) {
      assignedByTraveler.set(item.traveler_id, (assignedByTraveler.get(item.traveler_id) ?? 0) + amount)
    } else {
      unassignedTotal += amount
    }
  }
  const unassignedShares = splitEqually(unassignedTotal, effectiveN, minorUnitStep)

  // Named travelers occupy the first slots (in their stored position order) of the
  // effectiveN-length share arrays — any extra unnamed slot, when effectiveN exceeds
  // the number of names, is always last and therefore never displayed.
  return namedTravelers.map((traveler, index) => ({
    travelerId: traveler.id,
    name: traveler.name,
    total: dividedShares[index] + flatBase + (assignedByTraveler.get(traveler.id) ?? 0) + unassignedShares[index],
  }))
}

/**
 * Splits `total` into `count` equal shares in the currency's minor unit via the
 * largest-remainder method. Every share is mathematically identical before
 * rounding (an equal split of one pool), so "largest remainder" reduces to:
 * floor each share, then hand the leftover minor units one each to the first
 * `remainder` recipients, in order — stable between renders, matches Step A's
 * own "first in the list" rounding convention (Q7).
 */
function splitEqually(total: number, count: number, minorUnitStep: number): number[] {
  if (count <= 0) return []
  const totalMinorUnits = Math.round(total / minorUnitStep)
  const baseShareMinorUnits = Math.floor(totalMinorUnits / count)
  const remainder = totalMinorUnits - baseShareMinorUnits * count
  return Array.from({ length: count }, (_, index) => (baseShareMinorUnits + (index < remainder ? 1 : 0)) * minorUnitStep)
}
