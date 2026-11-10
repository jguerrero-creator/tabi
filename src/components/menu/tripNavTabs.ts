import { isMealsEnabled } from '../../lib/mealsFeatureSwitch'
import { strings } from '../../lib/strings'
import type { ReservationType } from '../../types/reservation'

export type NavTab = 'overview' | ReservationType | 'budget'

const BASE_TABS: { tab: NavTab; label: string; path: (tripId: string) => string }[] = [
  { tab: 'overview', label: strings.menus.overview, path: (tripId) => `/trips/${tripId}` },
  { tab: 'stay', label: strings.reservationTypeMenuLabel.stay, path: (tripId) => `/trips/${tripId}/stay` },
  { tab: 'transport', label: strings.reservationTypeMenuLabel.transport, path: (tripId) => `/trips/${tripId}/transport` },
  { tab: 'activity', label: strings.reservationTypeMenuLabel.activity, path: (tripId) => `/trips/${tripId}/activities` },
  { tab: 'budget', label: strings.menus.budget, path: (tripId) => `/trips/${tripId}/budget` },
]

// Step 5 (Meal plan): the Meals tab only exists while the feature switch is on — checked
// once per module load (i.e. per page load/reload), same cadence as every other
// isMealsEnabled() read in the app (AddReservationModal's type options, the /meals
// route below). With the switch off, this array has exactly the same 5 entries as
// before Meal existed; with it on, exactly 6 — see
// tests/e2e/souvenirs-budget-merge-navigation.spec.ts.
export const tripNavTabs: { tab: NavTab; label: string; path: (tripId: string) => string }[] = isMealsEnabled()
  ? [
      ...BASE_TABS.slice(0, 4),
      { tab: 'meal', label: strings.reservationTypeMenuLabel.meal, path: (tripId) => `/trips/${tripId}/meals` },
      ...BASE_TABS.slice(4),
    ]
  : BASE_TABS
