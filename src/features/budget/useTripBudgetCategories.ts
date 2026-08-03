import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { BudgetCategory } from '../../types/budgetCategory'

export interface BudgetCategoryInput {
  label: string
  amount: number
}

/**
 * Fetches every manually-entered budget category for a trip (TABI-57),
 * ordered by creation time since there's no natural sort key for free-form
 * categories.
 */
export function useTripBudgetCategories(tripId: string) {
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true })

    if (fetchError) {
      logClientError('useTripBudgetCategories.fetchCategories', fetchError)
      setError(fetchError.message)
    } else {
      setCategories(data ?? [])
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  const createCategory = useCallback(
    async (input: BudgetCategoryInput): Promise<BudgetCategory> => {
      const { data, error: createError } = await supabase
        .from('budget_categories')
        .insert({ trip_id: tripId, label: input.label, amount: input.amount })
        .select()
        .single()

      if (createError) throw createError
      setCategories((prev) => [...prev, data])
      return data
    },
    [tripId],
  )

  const updateCategory = useCallback(async (categoryId: string, patch: Partial<BudgetCategoryInput>) => {
    const { data, error: updateError } = await supabase
      .from('budget_categories')
      .update(patch)
      .eq('id', categoryId)
      .select()
      .single()

    if (updateError) throw updateError
    setCategories((prev) => prev.map((category) => (category.id === categoryId ? data : category)))
    return data
  }, [])

  const deleteCategory = useCallback(async (categoryId: string) => {
    const { error: deleteError } = await supabase.from('budget_categories').delete().eq('id', categoryId)
    if (deleteError) throw deleteError
    setCategories((prev) => prev.filter((category) => category.id !== categoryId))
  }, [])

  return { categories, loading, error, createCategory, updateCategory, deleteCategory, refetch: fetchCategories }
}
