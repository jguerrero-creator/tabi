import type { Database } from './database.types'

export type ChecklistItem = Database['public']['Tables']['checklist_items']['Row']
export type NewChecklistItem = Database['public']['Tables']['checklist_items']['Insert']
