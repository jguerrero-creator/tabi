import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { Reservation, ReservationType } from '../../types/reservation'

export function useReservationsByType(tripId: string, type: ReservationType) {
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
      .eq('type', type)
      .order('start_at', { ascending: true })

    if (fetchError) {
      logClientError('useReservationsByType.fetchReservations', fetchError)
      setError(fetchError.message)
    } else {
      setReservations(data ?? [])
    }
    setLoading(false)
  }, [tripId, type])

  useEffect(() => {
    fetchReservations()
  }, [fetchReservations])

  return { reservations, loading, error, refetch: fetchReservations }
}
