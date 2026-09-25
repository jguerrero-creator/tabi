import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { Reservation } from '../../types/reservation'

export function useTripReservations(tripId: string) {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('reservations')
        .select('*')
        .eq('trip_id', tripId)
        .order('start_at', { ascending: true })

      if (fetchError) {
        logClientError('useTripReservations.fetchReservations', fetchError)
        setError(fetchError.message)
      } else {
        setReservations(data ?? [])
      }
    } catch (err) {
      // A rejected fetch (network blip, not a resolved PostgREST error) would
      // otherwise skip setLoading(false) below entirely, stranding the screen
      // on its loading spinner forever with no visible error.
      logClientError('useTripReservations.fetchReservations', err)
      setError('Failed to fetch')
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => {
    fetchReservations()
  }, [fetchReservations])

  const updateReservationNote = useCallback(async (reservationId: string, note: string): Promise<void> => {
    const { data, error: updateError } = await supabase
      .from('reservations')
      .update({ note: note.trim() || null })
      .eq('id', reservationId)
      .select()
      .single()

    if (updateError) throw updateError
    setReservations((prev) => prev.map((r) => (r.id === reservationId ? data : r)))
  }, [])

  /** TABI-195: Planning drag-and-drop — moves a reservation to a validated new start/end. */
  const updateReservationDates = useCallback(
    async (
      reservationId: string,
      dates: { start_at: string; start_timezone: string | null; end_at: string | null; end_timezone: string | null },
    ): Promise<void> => {
      const { data, error: updateError } = await supabase
        .from('reservations')
        .update(dates)
        .eq('id', reservationId)
        .select()
        .single()

      if (updateError) throw updateError
      setReservations((prev) => prev.map((r) => (r.id === reservationId ? data : r)))
    },
    [],
  )

  /** TABI-76: applies an accepted reorder suggestion — each activity keeps every other column, only start/end move. */
  const reorderActivities = useCallback(
    async (updates: { id: string; start_at: string; end_at: string | null }[]): Promise<void> => {
      const results = await Promise.all(
        updates.map((update) =>
          supabase
            .from('reservations')
            .update({ start_at: update.start_at, end_at: update.end_at })
            .eq('id', update.id)
            .select()
            .single(),
        ),
      )
      const failed = results.find((result) => result.error)
      if (failed?.error) throw failed.error

      const byId = new Map(results.map((result) => [result.data!.id, result.data!]))
      setReservations((prev) => prev.map((r) => byId.get(r.id) ?? r))
    },
    [],
  )

  return {
    reservations,
    loading,
    error,
    refetch: fetchReservations,
    updateReservationNote,
    updateReservationDates,
    reorderActivities,
  }
}
