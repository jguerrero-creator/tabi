import type { Database } from './database.types'

export type Reminder = Database['public']['Tables']['reminders']['Row']
export type NewReminder = Database['public']['Tables']['reminders']['Insert']
