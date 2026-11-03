import type { Database } from './database.types'

export type SouvenirItem = Database['public']['Tables']['souvenir_items']['Row']
export type NewSouvenirItem = Database['public']['Tables']['souvenir_items']['Insert']

/** Reminder-only free text (e.g. "Maman") — never a traveller reference, no budget effect. */
export const SOUVENIR_RECIPIENT_MAX_LENGTH = 60
