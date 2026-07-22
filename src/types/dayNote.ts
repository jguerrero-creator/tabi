import type { Database } from './database.types'

export type TripDayNote = Database['public']['Tables']['trip_day_notes']['Row']
export type NewTripDayNote = Database['public']['Tables']['trip_day_notes']['Insert']
