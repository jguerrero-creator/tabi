import { useCallback, useEffect, useState } from 'react'
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
      setError(fetchError.message)
    } else {
      setTrip(data)
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchTrip()
  }, [fetchTrip])

  return { trip, loading, error, refetch: fetchTrip }
}
