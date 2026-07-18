import { useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { NewReservation, Reservation } from '../../types/reservation'

export function useCreateReservation(tripId: string) {
  const createReservation = useCallback(
    async (input: Omit<NewReservation, 'trip_id'>): Promise<Reservation> => {
      const { data, error } = await supabase
        .from('reservations')
        .insert({ ...input, trip_id: tripId })
        .select()
        .single()

      if (error) throw error
      return data
    },
    [tripId],
  )

  return { createReservation }
}
