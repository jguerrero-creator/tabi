import { useCallback, useEffect, useState } from 'react'
import { zonedTimeToUtc } from '../../lib/datetime'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { VehicleRentalLeg } from '../../types/vehicleRentalLeg'

export interface LegPlaceInput {
  placeName: string
  address: string | null
  lat: number
  lng: number
  timezone: string
}

export interface VehicleRentalLegInput {
  date: string
  departureTime: string
  departure: LegPlaceInput
  arrivalTime: string
  arrival: LegPlaceInput
}

/**
 * TABI-127: daily legs within a Vehicle Rental (at_disposal) reservation —
 * scoped to one reservation, purely additive detail on top of the rental's
 * own pickup/drop-off range. Never feeds computeFreeTimeBlocks or the
 * "covered days" logic (findActiveVehicleRental) — those stay untouched.
 */
export function useVehicleRentalLegs(reservationId: string, tripId: string) {
  const [legs, setLegs] = useState<VehicleRentalLeg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLegs = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('vehicle_rental_legs')
      .select('*')
      .eq('reservation_id', reservationId)
      .order('date', { ascending: true })
      .order('departure_at', { ascending: true })

    if (fetchError) {
      logClientError('useVehicleRentalLegs.fetchLegs', fetchError)
      setError(fetchError.message)
    } else {
      setLegs(data ?? [])
    }
    setLoading(false)
  }, [reservationId])

  useEffect(() => {
    fetchLegs()
  }, [fetchLegs])

  const addLeg = useCallback(
    async (input: VehicleRentalLegInput): Promise<VehicleRentalLeg> => {
      const { data, error: saveError } = await supabase
        .from('vehicle_rental_legs')
        .insert({
          reservation_id: reservationId,
          trip_id: tripId,
          date: input.date,
          departure_place_name: input.departure.placeName,
          departure_address: input.departure.address,
          departure_lat: input.departure.lat,
          departure_lng: input.departure.lng,
          departure_timezone: input.departure.timezone,
          departure_at: zonedTimeToUtc(input.date, input.departureTime, input.departure.timezone),
          arrival_place_name: input.arrival.placeName,
          arrival_address: input.arrival.address,
          arrival_lat: input.arrival.lat,
          arrival_lng: input.arrival.lng,
          arrival_timezone: input.arrival.timezone,
          arrival_at: zonedTimeToUtc(input.date, input.arrivalTime, input.arrival.timezone),
        })
        .select()
        .single()

      if (saveError) throw saveError
      setLegs((prev) =>
        [...prev, data].sort(
          (a, b) => a.date.localeCompare(b.date) || a.departure_at.localeCompare(b.departure_at),
        ),
      )
      return data
    },
    [reservationId, tripId],
  )

  const deleteLeg = useCallback(async (legId: string) => {
    const { error: deleteError } = await supabase.from('vehicle_rental_legs').delete().eq('id', legId)
    if (deleteError) throw deleteError
    setLegs((prev) => prev.filter((leg) => leg.id !== legId))
  }, [])

  return { legs, loading, error, addLeg, deleteLeg, refetch: fetchLegs }
}
