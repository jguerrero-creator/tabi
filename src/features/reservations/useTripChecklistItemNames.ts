import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'

export interface ChecklistItemName {
  id: string
  name: string
}

/**
 * Backlog: "Carte Planning checklist : afficher la liste complète des noms de lieux" —
 * every checklist-subtype Activity's item names, trip-wide, keyed by reservation id and
 * ordered by position. Only id+name is fetched (not full ChecklistItem rows): the Planning
 * card and Activities menu row just need the list of place names (plus a stable id for
 * React keys), not per-item place metadata — that only matters on the reservation's own
 * detail screen (ChecklistItemsSection already fetches the full rows there).
 */
export function useTripChecklistItemNames(tripId: string) {
  const [namesByReservationId, setNamesByReservationId] = useState<Map<string, ChecklistItemName[]>>(new Map())
  const [loading, setLoading] = useState(true)

  const fetchNames = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('checklist_items')
      .select('id, reservation_id, name')
      .eq('trip_id', tripId)
      .order('position', { ascending: true })

    if (error) {
      logClientError('useTripChecklistItemNames.fetchNames', error)
    } else {
      const map = new Map<string, ChecklistItemName[]>()
      for (const row of data ?? []) {
        const entry = { id: row.id, name: row.name }
        const existing = map.get(row.reservation_id)
        if (existing) {
          existing.push(entry)
        } else {
          map.set(row.reservation_id, [entry])
        }
      }
      setNamesByReservationId(map)
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchNames()
  }, [fetchNames])

  return { namesByReservationId, loading, refetch: fetchNames }
}
