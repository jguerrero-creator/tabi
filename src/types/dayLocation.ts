import type { Database } from './database.types'

export type TripDayLocation = Database['public']['Tables']['trip_day_locations']['Row']
export type NewTripDayLocation = Database['public']['Tables']['trip_day_locations']['Insert']
