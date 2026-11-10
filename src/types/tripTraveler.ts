import type { Database } from './database.types'

export type TripTraveler = Database['public']['Tables']['trip_travelers']['Row']
export type NewTripTraveler = Database['public']['Tables']['trip_travelers']['Insert']

/** Mirrors the DB CHECK constraint (trip_travelers_name_length) — enforced client-side too for instant feedback. */
export const TRIP_TRAVELER_NAME_MAX_LENGTH = 60
