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
    setLoading(false)
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

  return { reservations, loading, error, refetch: fetchReservations, updateReservationNote }
}
