import { strings } from '../../lib/strings'
import type { ReservationType } from '../../types/reservation'

export type NavTab = 'overview' | ReservationType | 'budget'

export const tripNavTabs: { tab: NavTab; label: string; path: (tripId: string) => string }[] = [
  { tab: 'overview', label: strings.menus.overview, path: (tripId) => `/trips/${tripId}` },
  { tab: 'stay', label: strings.menus.stay, path: (tripId) => `/trips/${tripId}/stay` },
  { tab: 'transport', label: strings.menus.transport, path: (tripId) => `/trips/${tripId}/transport` },
  { tab: 'activity', label: strings.menus.activities, path: (tripId) => `/trips/${tripId}/activities` },
  { tab: 'budget', label: strings.menus.budget, path: (tripId) => `/trips/${tripId}/budget` },
]
