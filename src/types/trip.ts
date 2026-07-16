import type { Database } from './database.types'

export type Trip = Database['public']['Tables']['trips']['Row']
export type NewTrip = Database['public']['Tables']['trips']['Insert']
