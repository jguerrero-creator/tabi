import { useEffect, useRef, useState } from 'react'
import { findActiveStay } from '../stay/computeAccommodationGaps'
import { buildTripLegs, legKey } from '../../lib/tripLegs'
import { logClientError } from '../../lib/logError'
import { fetchTravelTime, type LatLng, type TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'
import type { TripDayLocation } from '../../types/dayLocation'
import type { TripLegModeState } from './useTripLegTravelModes'

export interface TripLeg {
  fromReservationId: string
  toReservationId: string
  mode: TravelMode | null
  durationSeconds: number | null
  distanceMeters: number | null
  /** TABI-88: true when the Routes API's transit steps confirmed a same-station transfer. */
  hasDirectTransfer: boolean
  /** True once the user has explicitly dismissed a "no route" banner for this mode (TABI-200). */
  dismissed: boolean
  /**
   * True only while this leg's result was computed during THIS page session (as opposed to
   * loaded already-known from a previous session) — see `freshlyComputedKeys` below. Gates the
   * "no route" banner so a reload of an already-confirmed failure doesn't re-surface it; the
   * original bug (TABI-200) was that nothing persisted the failure, so it re-fired the API call
   * and re-showed the banner on every single Overview open.
   */
  justComputed: boolean
  /** Carried through from `TripLegInput` (TABI-155) so a "+ Add" quick-add can prefill locations. */
  origin: LatLng | null
  destination: LatLng
  /** UTC ISO string — see `TripLegInput.departureTime`. */
  departureTime: string
}

/**
 * Computes travel time between each consecutive pair of a trip's reservations.
 * A leg has no mode until the user picks one (TABI-154). `legModeState`
 * (TABI-200) supplies the persisted mode per leg, keyed by
 * `legKey(fromId, toId)`; a leg whose persisted state is already `computed`
 * reuses that stored result instead of re-calling the Routes API — this is
 * what stops a confirmed "no route" failure from re-firing the API and
 * re-showing its error banner on every Overview open. `onLegComputed`, when
 * given, is called with a freshly computed (not cached) result so the caller
 * can persist it; it is intentionally NOT called for a transient fetch error
 * (network/5xx) — only for a legitimate Routes API result (which may itself
 * have a null duration, meaning "no route") — so a transient failure is
 * retried on the next load rather than being persisted as permanent.
 */
export function useTripLegs(
  reservations: Reservation[],
  dayLocationsByDate: Map<string, TripDayLocation>,
  legModeState: Record<string, TripLegModeState> = {},
  onLegComputed?: (
    fromReservationId: string,
    toReservationId: string,
    mode: TravelMode,
    result: { durationSeconds: number | null; distanceMeters: number | null; hasDirectTransfer: boolean },
  ) => void,
) {
  const [legs, setLegs] = useState<TripLeg[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Keys this hook instance has itself computed a fresh result for (as opposed to loading an
  // already-persisted one on mount) — persists across the extra effect re-run that follows
  // `onLegComputed` writing to the DB, but resets on every real remount (page reload/navigation),
  // which is exactly the "surface once per session" behavior TABI-200 needs.
  const freshlyComputedKeys = useRef<Set<string>>(new Set())

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
        const key = legKey(leg.fromReservationId, leg.toReservationId)
        const persisted = legModeState[key]
        const mode = persisted?.mode ?? null
        const dismissed = persisted?.dismissed ?? false
        const base = {
          fromReservationId: leg.fromReservationId,
          toReservationId: leg.toReservationId,
          mode,
          dismissed,
          origin: leg.origin,
          destination: leg.destination,
          departureTime: leg.departureTime,
        }

        if (!leg.origin || !mode) {
          return {
            ...base,
            durationSeconds: null,
            distanceMeters: null,
            hasDirectTransfer: false,
            justComputed: false,
            needsPersist: false as const,
          }
        }

        // Already have an authoritative result (possibly a confirmed "no route") for this
        // mode — reuse it rather than re-billing the Routes API on every Overview open.
        // `justComputed` stays true here if THIS hook instance is the one that originally
        // computed it (freshlyComputedKeys survives the extra re-run `onLegComputed`'s DB
        // write triggers); it's false when the result was already persisted before this
        // page load, e.g. from a previous session — that's the reload case the banner must stay silent for.
        if (persisted?.computed) {
          return {
            ...base,
            durationSeconds: persisted.durationSeconds,
            distanceMeters: persisted.distanceMeters,
            hasDirectTransfer: persisted.hasDirectTransfer,
            justComputed: freshlyComputedKeys.current.has(key),
            needsPersist: false as const,
          }
        }

        // TABI-34: a single leg's fetch failing (network error, 5xx) must not wipe out every
        // other leg — fall back to the same "unknown duration" shape used when Routes API
        // itself finds no route, rather than letting it reject and fail the whole Promise.all.
        try {
          const result = await fetchTravelTime(leg.origin, leg.destination, mode, leg.departureTime)
          freshlyComputedKeys.current.add(key)
          return {
            ...base,
            durationSeconds: result.durationSeconds,
            distanceMeters: result.distanceMeters,
            hasDirectTransfer: result.hasDirectTransfer,
            justComputed: true,
            needsPersist: true as const,
            persistResult: result,
          }
        } catch (err) {
          logClientError('useTripLegs.fetchLeg', err)
          // Transient error (network/5xx) — not persisted, so it's retried on next load
          // rather than treated as a confirmed failure like a legitimate no-route result.
          return {
            ...base,
            durationSeconds: null,
            distanceMeters: null,
            hasDirectTransfer: false,
            justComputed: false,
            needsPersist: false as const,
          }
        }
      }),
    )
      .then((results) => {
        if (cancelled) return
        setLegs(results)
        for (const result of results) {
          if (result.needsPersist) {
            onLegComputed?.(result.fromReservationId, result.toReservationId, result.mode as TravelMode, result.persistResult)
          }
        }
      })
      .catch((err) => {
        logClientError('useTripLegs.computeLegs', err)
        if (!cancelled) setError('Failed to compute travel times')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reservations, dayLocationsByDate, legModeState, onLegComputed])

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
