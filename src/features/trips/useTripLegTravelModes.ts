import { useCallback, useEffect, useState } from 'react'
import { legKey } from '../../lib/tripLegs'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { TravelMode } from '../../lib/travelTime'

export interface TripLegModeState {
  mode: TravelMode
  durationSeconds: number | null
  distanceMeters: number | null
  /** True once a result (even a "no route found" null) has been computed and persisted for this mode. */
  computed: boolean
  /** True once the user has acknowledged a "no route" banner for this mode — suppresses re-showing it. */
  dismissed: boolean
}

/**
 * TABI-200: persists the "Getting Around" travel mode chosen per leg (and its
 * computed result, or its confirmed-unavailable failure) so it survives a
 * reload instead of resetting to "no mode chosen" every time. Keyed by
 * `legKey(fromReservationId, toReservationId)`, same identity `useTripLegs`
 * already uses — a leg is anchored to two specific reservation instances, so
 * revisiting the same city pair on a different day naturally gets its own row.
 */
export function useTripLegTravelModes(tripId: string) {
  const [stateByKey, setStateByKey] = useState<Record<string, TripLegModeState>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchModes = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('trip_leg_travel_modes')
      .select('*')
      .eq('trip_id', tripId)

    if (fetchError) {
      logClientError('useTripLegTravelModes.fetchModes', fetchError)
      setError(fetchError.message)
    } else {
      setStateByKey(
        Object.fromEntries(
          (data ?? []).map((row) => [
            legKey(row.from_reservation_id, row.to_reservation_id),
            {
              mode: row.mode,
              durationSeconds: row.duration_seconds,
              distanceMeters: row.distance_meters,
              computed: row.computed_at !== null,
              dismissed: row.dismissed_at !== null,
            },
          ]),
        ),
      )
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchModes()
  }, [fetchModes])

  // Picking a mode (including re-picking a previously failed one) clears any
  // prior result/dismissal so it's treated as a fresh choice to compute.
  const setLegMode = useCallback(
    async (fromReservationId: string, toReservationId: string, mode: TravelMode) => {
      const key = legKey(fromReservationId, toReservationId)
      setStateByKey((prev) => ({
        ...prev,
        [key]: { mode, durationSeconds: null, distanceMeters: null, computed: false, dismissed: false },
      }))

      const { error: saveError } = await supabase.from('trip_leg_travel_modes').upsert(
        {
          trip_id: tripId,
          from_reservation_id: fromReservationId,
          to_reservation_id: toReservationId,
          mode,
          duration_seconds: null,
          distance_meters: null,
          computed_at: null,
          dismissed_at: null,
        },
        { onConflict: 'trip_id,from_reservation_id,to_reservation_id' },
      )
      if (saveError) logClientError('useTripLegTravelModes.setLegMode', saveError)
    },
    [tripId],
  )

  // Persists a freshly computed result for the mode that was selected when the
  // computation started — scoped by `mode` in the WHERE clause so a result for
  // a mode the user has since changed away from doesn't overwrite the new choice.
  const setLegResult = useCallback(
    async (
      fromReservationId: string,
      toReservationId: string,
      mode: TravelMode,
      result: { durationSeconds: number | null; distanceMeters: number | null },
    ) => {
      const key = legKey(fromReservationId, toReservationId)
      const { data, error: saveError } = await supabase
        .from('trip_leg_travel_modes')
        .update({
          duration_seconds: result.durationSeconds,
          distance_meters: result.distanceMeters,
          computed_at: new Date().toISOString(),
        })
        .eq('trip_id', tripId)
        .eq('from_reservation_id', fromReservationId)
        .eq('to_reservation_id', toReservationId)
        .eq('mode', mode)
        .select()
        .maybeSingle()

      if (saveError) {
        logClientError('useTripLegTravelModes.setLegResult', saveError)
        return
      }
      if (!data) return // mode changed meanwhile — this result is stale, drop it

      setStateByKey((prev) => ({
        ...prev,
        [key]: {
          mode: data.mode,
          durationSeconds: data.duration_seconds,
          distanceMeters: data.distance_meters,
          computed: true,
          dismissed: prev[key]?.dismissed ?? false,
        },
      }))
    },
    [tripId],
  )

  const dismissLegError = useCallback(
    async (fromReservationId: string, toReservationId: string) => {
      const key = legKey(fromReservationId, toReservationId)
      setStateByKey((prev) => {
        const existing = prev[key]
        if (!existing) return prev
        return { ...prev, [key]: { ...existing, dismissed: true } }
      })

      const { error: saveError } = await supabase
        .from('trip_leg_travel_modes')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('trip_id', tripId)
        .eq('from_reservation_id', fromReservationId)
        .eq('to_reservation_id', toReservationId)
      if (saveError) logClientError('useTripLegTravelModes.dismissLegError', saveError)
    },
    [tripId],
  )

  return { stateByKey, loading, error, setLegMode, setLegResult, dismissLegError, refetch: fetchModes }
}
