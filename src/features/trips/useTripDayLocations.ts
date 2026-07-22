import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { TripDayLocation } from '../../types/dayLocation'

export interface DayLocationInput {
  placeName: string
  address: string | null
  lat: number
  lng: number
  timezone: string | null
  city: string | null
}

/**
 * Fetches every planned day-location for a trip (TABI-114), keyed by date
 * (`YYYY-MM-DD`, matching groupByDate's dateKey) so callers can look one up
 * per day without scanning the list.
 */
export function useTripDayLocations(tripId: string) {
  const [locationsByDate, setLocationsByDate] = useState<Map<string, TripDayLocation>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLocations = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase.from('trip_day_locations').select('*').eq('trip_id', tripId)

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setLocationsByDate(new Map((data ?? []).map((row) => [row.date, row])))
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchLocations()
  }, [fetchLocations])

  const saveDayLocation = useCallback(
    async (date: string, input: DayLocationInput): Promise<void> => {
      const { data, error: saveError } = await supabase
        .from('trip_day_locations')
        .upsert(
          {
            trip_id: tripId,
            date,
            place_name: input.placeName,
            address: input.address,
            lat: input.lat,
            lng: input.lng,
            timezone: input.timezone,
            city: input.city,
          },
          { onConflict: 'trip_id,date' },
        )
        .select()
        .single()

      if (saveError) throw saveError
      setLocationsByDate((prev) => new Map(prev).set(date, data))
    },
    [tripId],
  )

  const clearDayLocation = useCallback(
    async (date: string) => {
      const { error: deleteError } = await supabase
        .from('trip_day_locations')
        .delete()
        .eq('trip_id', tripId)
        .eq('date', date)

      if (deleteError) throw deleteError
      setLocationsByDate((prev) => {
        const next = new Map(prev)
        next.delete(date)
        return next
      })
    },
    [tripId],
  )

  return { locationsByDate, loading, error, saveDayLocation, clearDayLocation, refetch: fetchLocations }
}
