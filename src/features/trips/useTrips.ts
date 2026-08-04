import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { NewTrip, Trip } from '../../types/trip'
import type { Enums } from '../../types/database.types'

interface CreateTripInput {
  name: string
  start_date: string | null
  end_date: string | null
  destinations: string[]
  trip_type?: Enums<'trip_type'> | null
  currency: string
  day_start_time: string
  day_end_time: string
  note?: string | null
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
      logClientError('useTrips.fetchTrips', fetchError)
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
      destinations: input.destinations,
      trip_type: input.trip_type ?? null,
      currency: input.currency,
      day_start_time: input.day_start_time,
      day_end_time: input.day_end_time,
      note: input.note ?? null,
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

  const updateTrip = useCallback(async (tripId: string, input: CreateTripInput) => {
    const { data, error: updateError } = await supabase
      .from('trips')
      .update({
        name: input.name,
        start_date: input.start_date,
        end_date: input.end_date,
        destinations: input.destinations,
        trip_type: input.trip_type ?? null,
        currency: input.currency,
        day_start_time: input.day_start_time,
        day_end_time: input.day_end_time,
        note: input.note ?? null,
      })
      .eq('id', tripId)
      .select()
      .single()

    if (updateError) throw updateError

    setTrips((current) => current.map((trip) => (trip.id === tripId ? data : trip)).sort(compareByStartDate))
    return data
  }, [])

  const deleteTrip = useCallback(async (tripId: string) => {
    const { error: deleteError } = await supabase.from('trips').delete().eq('id', tripId)
    if (deleteError) throw deleteError

    setTrips((current) => current.filter((trip) => trip.id !== tripId))
  }, [])

  return { trips, loading, error, createTrip, updateTrip, deleteTrip, refetch: fetchTrips }
}

function compareByStartDate(a: Trip, b: Trip) {
  if (!a.start_date) return 1
  if (!b.start_date) return -1
  return a.start_date.localeCompare(b.start_date)
}
