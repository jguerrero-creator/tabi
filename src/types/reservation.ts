import type { Database } from './database.types'

export type Reservation = Database['public']['Tables']['reservations']['Row']
export type NewReservation = Database['public']['Tables']['reservations']['Insert']
export type ReservationUpdate = Database['public']['Tables']['reservations']['Update']
export type ReservationType = Database['public']['Enums']['reservation_type']
export type ReservationStatus = Database['public']['Enums']['reservation_status']
