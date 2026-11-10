import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { TripTraveler } from '../../types/tripTraveler'

const POSTGRES_UNIQUE_VIOLATION = '23505'

export class DuplicateTravelerNameError extends Error {}

/**
 * Named travelers for a trip (TABI-263 Step A), ordered by `position` (insertion
 * order — the list order itself matters later, for Step B's rounding tie-break).
 *
 * `travelerCount`/`onTravelerCountBumped` implement the reconciliation rule decided
 * for TABI-263: the trip's numeric traveler_count stays authoritative and editable,
 * names are optional labels on top of it. Adding a name beyond the current count
 * bumps the count up immediately (persisted right away, not deferred to the trip
 * form's Save button) so an existing trip's Stay-per-person split is never silently
 * changed by typing just one name — removing a name never lowers the count; that's
 * done by editing the number field instead.
 */
export function useTripTravelers(tripId: string, travelerCount: number, onTravelerCountBumped: (newCount: number) => void) {
  const [travelers, setTravelers] = useState<TripTraveler[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTravelers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('trip_travelers')
      .select('*')
      .eq('trip_id', tripId)
      .order('position', { ascending: true })

    if (fetchError) {
      logClientError('useTripTravelers.fetchTravelers', fetchError)
      setError(fetchError.message)
    } else {
      setTravelers(data ?? [])
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchTravelers()
  }, [fetchTravelers])

  const createTraveler = useCallback(
    async (name: string): Promise<TripTraveler> => {
      const nextPosition = travelers.length === 0 ? 0 : Math.max(...travelers.map((traveler) => traveler.position)) + 1
      const { data, error: createError } = await supabase
        .from('trip_travelers')
        .insert({ trip_id: tripId, name, position: nextPosition })
        .select()
        .single()

      if (createError) {
        if (createError.code === POSTGRES_UNIQUE_VIOLATION) throw new DuplicateTravelerNameError(createError.message)
        throw createError
      }
      setTravelers((prev) => [...prev, data])

      const newNamedTotal = travelers.length + 1
      if (newNamedTotal > travelerCount) {
        const { error: bumpError } = await supabase.from('trips').update({ traveler_count: newNamedTotal }).eq('id', tripId)
        if (bumpError) {
          // The traveler row saved fine; only the count bump failed. Not re-thrown — the
          // caller's save succeeded from their perspective, and the next add will retry
          // the same bump since newNamedTotal > travelerCount still holds.
          logClientError('useTripTravelers.createTraveler.bumpTravelerCount', bumpError)
        } else {
          onTravelerCountBumped(newNamedTotal)
        }
      }

      return data
    },
    [tripId, travelers, travelerCount, onTravelerCountBumped],
  )

  const renameTraveler = useCallback(async (travelerId: string, name: string): Promise<TripTraveler> => {
    const { data, error: updateError } = await supabase
      .from('trip_travelers')
      .update({ name })
      .eq('id', travelerId)
      .select()
      .single()

    if (updateError) {
      if (updateError.code === POSTGRES_UNIQUE_VIOLATION) throw new DuplicateTravelerNameError(updateError.message)
      throw updateError
    }
    setTravelers((prev) => prev.map((traveler) => (traveler.id === travelerId ? data : traveler)))
    return data
  }, [])

  const deleteTraveler = useCallback(async (travelerId: string) => {
    const { error: deleteError } = await supabase.from('trip_travelers').delete().eq('id', travelerId)
    if (deleteError) throw deleteError
    setTravelers((prev) => prev.filter((traveler) => traveler.id !== travelerId))
  }, [])

  return { travelers, loading, error, createTraveler, renameTraveler, deleteTraveler, refetch: fetchTravelers }
}
