import type { Database } from './database.types'

export type TripLegTravelMode = Database['public']['Tables']['trip_leg_travel_modes']['Row']
export type NewTripLegTravelMode = Database['public']['Tables']['trip_leg_travel_modes']['Insert']
