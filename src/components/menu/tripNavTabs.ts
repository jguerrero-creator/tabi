import { strings } from '../../lib/strings'
import type { ReservationType } from '../../types/reservation'

export type NavTab = 'overview' | ReservationType | 'budget'

export const tripNavTabs: { tab: NavTab; label: string; path: (tripId: string) => string }[] = [
  { tab: 'overview', label: strings.menus.overview, path: (tripId) => `/trips/${tripId}` },
  { tab: 'stay', label: strings.reservationTypeMenuLabel.stay, path: (tripId) => `/trips/${tripId}/stay` },
  { tab: 'transport', label: strings.reservationTypeMenuLabel.transport, path: (tripId) => `/trips/${tripId}/transport` },
  { tab: 'activity', label: strings.reservationTypeMenuLabel.activity, path: (tripId) => `/trips/${tripId}/activities` },
  { tab: 'budget', label: strings.menus.budget, path: (tripId) => `/trips/${tripId}/budget` },
]
