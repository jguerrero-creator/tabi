import type { Database } from './database.types'

export type SouvenirItem = Database['public']['Tables']['souvenir_items']['Row']
export type NewSouvenirItem = Database['public']['Tables']['souvenir_items']['Insert']
