import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { ChecklistItem } from '../../types/checklistItem'

export interface ChecklistItemPlaceInput {
  address: string | null
  lat: number | null
  lng: number | null
  googlePlaceId: string | null
  category: string | null
  rating: number | null
  userRatingsTotal: number | null
  photoRef: string | null
}

export interface NewChecklistItemInput {
  name: string
  place: ChecklistItemPlaceInput | null
}

/**
 * Checklist-subtype Activity (TABI: "checklist" sous-type) — each item is a lightweight
 * candidate place, not a full Reservation of its own, and carries no "done" state (spec:
 * reference list only, no per-item completion tracking). checklist_item_count on the parent
 * reservation is maintained by a DB trigger, never written here.
 */
export function useChecklistItems(reservationId: string, tripId: string) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('checklist_items')
      .select('*')
      .eq('reservation_id', reservationId)
      .order('position', { ascending: true })

    if (fetchError) {
      logClientError('useChecklistItems.fetchItems', fetchError)
      setError(fetchError.message)
    } else {
      setItems(data ?? [])
    }
    setLoading(false)
  }, [reservationId])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const addItem = useCallback(
    async (input: NewChecklistItemInput): Promise<ChecklistItem> => {
      const { data, error: saveError } = await supabase
        .from('checklist_items')
        .insert({
          reservation_id: reservationId,
          trip_id: tripId,
          name: input.name,
          address: input.place?.address ?? null,
          lat: input.place?.lat ?? null,
          lng: input.place?.lng ?? null,
          place_google_id: input.place?.googlePlaceId ?? null,
          place_category: input.place?.category ?? null,
          place_rating: input.place?.rating ?? null,
          place_user_ratings_total: input.place?.userRatingsTotal ?? null,
          place_photo_ref: input.place?.photoRef ?? null,
          position: items.length,
        })
        .select()
        .single()

      if (saveError) throw saveError
      setItems((prev) => [...prev, data].sort((a, b) => a.position - b.position))
      return data
    },
    [reservationId, tripId, items.length],
  )

  const renameItem = useCallback(async (itemId: string, name: string) => {
    const { data, error: saveError } = await supabase
      .from('checklist_items')
      .update({ name })
      .eq('id', itemId)
      .select()
      .single()

    if (saveError) throw saveError
    setItems((prev) => prev.map((item) => (item.id === itemId ? data : item)))
    return data
  }, [])

  const deleteItem = useCallback(async (itemId: string) => {
    const { error: deleteError } = await supabase.from('checklist_items').delete().eq('id', itemId)
    if (deleteError) throw deleteError
    setItems((prev) => prev.filter((item) => item.id !== itemId))
  }, [])

  return { items, loading, error, addItem, renameItem, deleteItem, refetch: fetchItems }
}
