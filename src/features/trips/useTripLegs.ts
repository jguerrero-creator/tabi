import { useEffect, useState } from 'react'
import { buildTripLegs, legKey } from '../../lib/tripLegs'
import { fetchTravelTime, type TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'

export interface TripLeg {
  fromReservationId: string
  toReservationId: string
  mode: TravelMode
  durationSeconds: number | null
  distanceMeters: number | null
}

const defaultMode: TravelMode = 'DRIVE'

/**
 * Computes travel time between each consecutive pair of a trip's reservations.
 * Each leg defaults to driving; pass a mode override keyed by `legKey(fromId, toId)`
 * to compute that leg with a different transport mode instead.
 */
export function useTripLegs(reservations: Reservation[], modeByLeg: Record<string, TravelMode> = {}) {
  const [legs, setLegs] = useState<TripLeg[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const legInputs = buildTripLegs(reservations)
    if (legInputs.length === 0) {
      setLegs([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all(
      legInputs.map(async (leg) => {
        const mode = modeByLeg[legKey(leg.fromReservationId, leg.toReservationId)] ?? defaultMode
        const result = await fetchTravelTime(leg.origin, leg.destination, mode, leg.departureTime)
        return {
          fromReservationId: leg.fromReservationId,
          toReservationId: leg.toReservationId,
          mode,
          durationSeconds: result.durationSeconds,
          distanceMeters: result.distanceMeters,
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setLegs(results)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to compute travel times')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reservations, modeByLeg])

  return { legs, loading, error }
}
