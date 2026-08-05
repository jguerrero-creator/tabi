import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { SouvenirItem } from '../../types/souvenirItem'

export interface SouvenirItemInput {
  label: string
  is_checked: boolean
}

/**
 * Fetches every souvenir/shopping checklist item for a trip (TABI-52),
 * ordered by creation time since there's no natural sort key for a
 * free-form checklist.
 */
export function useTripSouvenirItems(tripId: string) {
  const [items, setItems] = useState<SouvenirItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('souvenir_items')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true })

    if (fetchError) {
      logClientError('useTripSouvenirItems.fetchItems', fetchError)
      setError(fetchError.message)
    } else {
      setItems(data ?? [])
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const createItem = useCallback(
    async (input: Pick<SouvenirItemInput, 'label'>): Promise<SouvenirItem> => {
      const { data, error: createError } = await supabase
        .from('souvenir_items')
        .insert({ trip_id: tripId, label: input.label })
        .select()
        .single()

      if (createError) throw createError
      setItems((prev) => [...prev, data])
      return data
    },
    [tripId],
  )

  const updateItem = useCallback(async (itemId: string, patch: Partial<SouvenirItemInput>) => {
    const { data, error: updateError } = await supabase
      .from('souvenir_items')
      .update(patch)
      .eq('id', itemId)
      .select()
      .single()

    if (updateError) throw updateError
    setItems((prev) => prev.map((item) => (item.id === itemId ? data : item)))
    return data
  }, [])

  const deleteItem = useCallback(async (itemId: string) => {
    const { error: deleteError } = await supabase.from('souvenir_items').delete().eq('id', itemId)
    if (deleteError) throw deleteError
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }, [])

  return { items, loading, error, createItem, updateItem, deleteItem, refetch: fetchItems }
}
