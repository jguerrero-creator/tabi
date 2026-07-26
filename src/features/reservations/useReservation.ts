import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { Reservation, ReservationUpdate } from '../../types/reservation'

export function useReservation(reservationId: string) {
  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReservation = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', reservationId)
      .maybeSingle()

    if (fetchError) {
      logClientError('useReservation.fetchReservation', fetchError)
      setError(fetchError.message)
    } else {
      setReservation(data)
    }
    setLoading(false)
  }, [reservationId])

  useEffect(() => {
    fetchReservation()
  }, [fetchReservation])

  const updateReservation = useCallback(
    async (patch: ReservationUpdate) => {
      const { data, error: updateError } = await supabase
        .from('reservations')
        .update(patch)
        .eq('id', reservationId)
        .select()
        .single()

      if (updateError) throw updateError
      setReservation(data)
      return data
    },
    [reservationId],
  )

  const deleteReservation = useCallback(async () => {
    const { error: deleteError } = await supabase.from('reservations').delete().eq('id', reservationId)
    if (deleteError) throw deleteError
  }, [reservationId])

  return { reservation, loading, error, updateReservation, deleteReservation, refetch: fetchReservation }
}
