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
  traveler_count: number
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

    // TABI: every trip gets a dedicated inbound-import address (forward a booking
    // confirmation to it and it feeds the same extraction pipeline as every other
    // channel). Generated client-side since trip creation has no server function to
    // hook into; the DB's unique constraint is the real guarantee, this retry loop
    // just handles the rare random-suffix collision without surfacing it to the user.
    let data: Trip | null = null
    let insertError: { code?: string; message: string } | null = null
    for (let attempt = 0; attempt < 5 && !data; attempt++) {
      const newTrip: NewTrip = {
        organizer_id: userData.user.id,
        name: input.name,
        start_date: input.start_date,
        end_date: input.end_date,
        destinations: input.destinations,
        trip_type: input.trip_type ?? null,
        currency: input.currency,
        traveler_count: input.traveler_count,
        day_start_time: input.day_start_time,
        day_end_time: input.day_end_time,
        note: input.note ?? null,
        inbound_email_local_part: generateInboundEmailLocalPart(input.name),
      }

      const result = await supabase.from('trips').insert(newTrip).select().single()
      if (!result.error) {
        data = result.data
        break
      }
      insertError = result.error
      if (result.error.code !== '23505') break
    }

    if (!data) throw insertError ?? new Error('Failed to create trip')

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
        traveler_count: input.traveler_count,
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

// Must match the DB check constraint (^[a-z0-9]+(-[a-z0-9]+)*$) — lowercase,
// accent-stripped, non-alphanumeric runs collapsed to a single hyphen, no
// leading/trailing hyphen. A short random suffix is what actually guarantees
// unique-enough addresses; the trip-name prefix is just so the inbox is legible.
function generateInboundEmailLocalPart(tripName: string): string {
  const base = tripName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
  const suffix = Math.random().toString(36).slice(2, 6)
  return base ? `${base}-${suffix}` : suffix
}
