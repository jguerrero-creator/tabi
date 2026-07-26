import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { Trip } from '../../types/trip'

export function useTrip(tripId: string) {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTrip = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .maybeSingle()

    if (fetchError) {
      logClientError('useTrip.fetchTrip', fetchError)
      setError(fetchError.message)
    } else {
      setTrip(data)
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchTrip()
  }, [fetchTrip])

  // TABI-113: lets a reservation outside the trip's current dates extend it, without
  // requiring the full trip-edit form shape that useTrips().updateTrip expects.
  const updateDates = useCallback(
    async (startDate: string, endDate: string) => {
      const { data, error: updateError } = await supabase
        .from('trips')
        .update({ start_date: startDate, end_date: endDate })
        .eq('id', tripId)
        .select()
        .single()
      if (updateError) throw updateError
      setTrip(data)
      return data
    },
    [tripId],
  )

  return { trip, loading, error, refetch: fetchTrip, updateDates }
}
