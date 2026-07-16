import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { NewTrip, Trip } from '../../types/trip'

interface CreateTripInput {
  name: string
  start_date: string | null
  end_date: string | null
}

export function useTrips() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTrips = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('trips')
      .select('*')
      .order('start_date', { ascending: true, nullsFirst: false })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setTrips(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchTrips()
  }, [fetchTrips])

  const createTrip = useCallback(async (input: CreateTripInput) => {
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      throw userError ?? new Error('No authenticated user')
    }

    const newTrip: NewTrip = {
      organizer_id: userData.user.id,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
    }

    const { data, error: insertError } = await supabase
      .from('trips')
      .insert(newTrip)
      .select()
      .single()

    if (insertError) throw insertError

    setTrips((current) => [...current, data].sort(compareByStartDate))
    return data
  }, [])

  return { trips, loading, error, createTrip, refetch: fetchTrips }
}

function compareByStartDate(a: Trip, b: Trip) {
  if (!a.start_date) return 1
  if (!b.start_date) return -1
  return a.start_date.localeCompare(b.start_date)
}
