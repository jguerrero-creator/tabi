import { useEffect, useState } from 'react'
import { findActiveStay } from '../stay/computeAccommodationGaps'
import { buildTripLegs, legKey } from '../../lib/tripLegs'
import { fetchTravelTime, type LatLng, type TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'
import type { TripDayLocation } from '../../types/dayLocation'

export interface TripLeg {
  fromReservationId: string
  toReservationId: string
  mode: TravelMode | null
  durationSeconds: number | null
  distanceMeters: number | null
}

/**
 * Computes travel time between each consecutive pair of a trip's reservations.
 * A leg has no mode until the user picks one (TABI-154); pass a mode override
 * keyed by `legKey(fromId, toId)` to compute that leg with a chosen transport mode.
 */
export function useTripLegs(
  reservations: Reservation[],
  dayLocationsByDate: Map<string, TripDayLocation>,
  modeByLeg: Record<string, TravelMode> = {},
) {
  const [legs, setLegs] = useState<TripLeg[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const legInputs = buildTripLegs(reservations, (dateKey) =>
      resolveCoveredDayAnchor(dateKey, reservations, dayLocationsByDate),
    )
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
        const mode = modeByLeg[legKey(leg.fromReservationId, leg.toReservationId)] ?? null
        if (!leg.origin || !mode) {
          return {
            fromReservationId: leg.fromReservationId,
            toReservationId: leg.toReservationId,
            mode,
            durationSeconds: null,
            distanceMeters: null,
          }
        }
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
  }, [reservations, dayLocationsByDate, modeByLeg])

  return { legs, loading, error }
}

function resolveCoveredDayAnchor(
  dateKey: string,
  reservations: Reservation[],
  dayLocationsByDate: Map<string, TripDayLocation>,
): LatLng | null {
  const dayLocation = dayLocationsByDate.get(dateKey)
  if (dayLocation) return { lat: dayLocation.lat, lng: dayLocation.lng }

  const activeStay = findActiveStay(dateKey, reservations)
  if (!activeStay || activeStay.start_lat === null || activeStay.start_lng === null) return null
  return { lat: activeStay.start_lat, lng: activeStay.start_lng }
}
