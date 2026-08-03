import type { Database } from './database.types'

export type BudgetCategory = Database['public']['Tables']['budget_categories']['Row']
export type NewBudgetCategory = Database['public']['Tables']['budget_categories']['Insert']
