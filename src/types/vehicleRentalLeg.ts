import type { Database } from './database.types'

export type VehicleRentalLeg = Database['public']['Tables']['vehicle_rental_legs']['Row']
export type NewVehicleRentalLeg = Database['public']['Tables']['vehicle_rental_legs']['Insert']
