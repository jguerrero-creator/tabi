import { useMemo } from 'react'
import { TravelModePicker } from '../../components/ui/TravelModePicker'
import { Spinner } from '../../components/ui/Spinner'
import { localDateKey, zonedTimeToUtc } from '../../lib/datetime'
import { formatDuration, formatDistance } from '../../lib/duration'
import { computeFreeTimeBlocks, MIN_FREE_SECONDS_TO_SHOW } from '../../lib/freeTimeBlocks'
import { legKey, resolveLegEndpointPlace, type LegEndpointPlace } from '../../lib/tripLegs'
import type { TravelMode } from '../../lib/travelTime'
import { strings } from '../../lib/strings'
import type { Reservation } from '../../types/reservation'
import type { Trip } from '../../types/trip'
import type { TripLeg } from './useTripLegs'

/**
 * TABI-155: prefill payload handed up to `OverviewScreen` to open the shared Add sheet.
 * Always a point-to-point Transport reservation — a computed "Getting Around" leg only
 * ever exists between two real bookings, never for a vehicle rental (TABI-121/124).
 */
export interface LegQuickAddPayload {
  initialStartAt: string
  initialEndAt: string
  initialTimezone: string
  initialEndTimezone: string
  initialStartPlace: LegEndpointPlace
  initialEndPlace: LegEndpointPlace
}

interface TripLegsSectionProps {
  reservations: Reservation[]
  legs: TripLeg[]
  loading: boolean
  error: string | null
  trip: Trip | null
  onModeChange: (fromReservationId: string, toReservationId: string, mode: TravelMode) => void
  onDismissError: (fromReservationId: string, toReservationId: string) => void
  onQuickAddTransport: (payload: LegQuickAddPayload) => void
}

export function TripLegsSection({
  reservations,
  legs,
  loading,
  error,
  trip,
  onModeChange,
  onDismissError,
  onQuickAddTransport,
}: TripLegsSectionProps) {
  const freeTimeByLeg = useMemo(() => {
    const blocks = computeFreeTimeBlocks(reservations, legs)
    return new Map(blocks.map((block) => [legKey(block.fromReservationId, block.toReservationId), block]))
  }, [reservations, legs])

  const byId = new Map(reservations.map((reservation) => [reservation.id, reservation]))

  if (!loading && !error && legs.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {strings.tripLegs.title}
      </h2>

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          <Spinner />
          {strings.tripLegs.loading}
        </div>
      )}

      {!loading && error && (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-red-600">
          {strings.tripLegs.errorLoading}
        </p>
      )}

      {!loading && !error && (
        <ul className="space-y-2">
          {legs.map((leg) => {
            const from = byId.get(leg.fromReservationId)
            const to = byId.get(leg.toReservationId)
            const key = legKey(leg.fromReservationId, leg.toReservationId)
            const freeBlock = freeTimeByLeg.get(key)
            const quickAddPayload = buildQuickAddPayload(leg, from, to, trip)
            return (
              <li key={key} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="truncate text-sm font-medium text-slate-900">
                  {from?.name ?? '—'} → {to?.name ?? '—'}
                </p>
                <div className="mb-2">
                  {leg.mode === null ? (
                    <p className="text-xs text-slate-500">{strings.tripLegs.selectMode}</p>
                  ) : leg.durationSeconds === null && isTransitMode(leg.mode) && leg.justComputed && !leg.dismissed ? (
                    <p className="flex items-start justify-between gap-2 text-xs font-medium text-amber-700">
                      <span>{strings.tripLegs.noTransitRoute}</span>
                      <button
                        type="button"
                        onClick={() => onDismissError(leg.fromReservationId, leg.toReservationId)}
                        aria-label={strings.tripLegs.dismissError}
                        className="shrink-0 text-amber-700 hover:text-amber-900"
                      >
                        ✕
                      </button>
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">{formatLeg(leg.durationSeconds, leg.distanceMeters)}</p>
                  )}
                  {freeBlock && freeBlock.durationSeconds < 0 && (
                    <p className="text-xs font-medium text-red-600">
                      {strings.tripLegs.tightConnection(formatDuration(Math.abs(freeBlock.durationSeconds)))}
                    </p>
                  )}
                  {freeBlock && freeBlock.durationSeconds >= MIN_FREE_SECONDS_TO_SHOW && (
                    <p className="text-xs font-medium text-teal-700">
                      {strings.tripLegs.freeTime(formatDuration(freeBlock.durationSeconds))}
                    </p>
                  )}
                  {freeBlock?.tooLongTravel && (
                    <p className="text-xs font-medium text-amber-700">
                      {strings.tripLegs.longTravel(formatDuration(freeBlock.travelSeconds))}
                    </p>
                  )}
                  {leg.hasDirectTransfer && (
                    <span className="mt-1 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                      {strings.tripLegs.directTransferBadge}
                    </span>
                  )}
                </div>
                <TravelModePicker
                  value={leg.mode}
                  onChange={(mode) => onModeChange(leg.fromReservationId, leg.toReservationId, mode)}
                />
                {quickAddPayload && (
                  <button
                    type="button"
                    onClick={() => onQuickAddTransport(quickAddPayload)}
                    className="mt-2 rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50"
                  >
                    {strings.tripLegs.addAsReservation}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function formatLeg(durationSeconds: number | null, distanceMeters: number | null): string {
  const parts: string[] = []
  if (durationSeconds !== null) parts.push(formatDuration(durationSeconds))
  if (distanceMeters !== null) parts.push(formatDistance(distanceMeters))
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** TRAIN is TRANSIT narrowed to rail (see api/travel-time.ts) — both hit the same no-route gap. */
function isTransitMode(mode: TravelMode): boolean {
  return mode === 'TRANSIT' || mode === 'TRAIN'
}

/**
 * TABI-155: builds the "+ Add" prefill payload once a leg has a chosen mode
 * and both endpoints resolve back to a real reservation's address — null
 * otherwise (no mode yet, or an endpoint anchored to a day's planned location
 * or active stay instead of a reservation's own address, TABI-124), so the
 * button never opens a sheet prefilled with a guessed or missing address.
 * Arrival is estimated from the computed leg duration when available;
 * otherwise it falls back to the same instant as departure, left for the
 * user to correct — the departure time itself is intentionally NOT the
 * computed departure instant but the trip's day-window start, since the
 * exact time isn't confirmed yet at this "to book" stage.
 */
function buildQuickAddPayload(
  leg: TripLeg,
  from: Reservation | undefined,
  to: Reservation | undefined,
  trip: Trip | null,
): LegQuickAddPayload | null {
  if (!leg.mode || !leg.origin || !from || !to || !trip) return null

  const startPlace = resolveLegEndpointPlace(from, leg.origin)
  const endPlace = resolveLegEndpointPlace(to, leg.destination)
  if (!startPlace || !endPlace) return null

  const dateKey = localDateKey(leg.departureTime, startPlace.timezone)
  const initialStartAt = zonedTimeToUtc(dateKey, trip.day_start_time, startPlace.timezone)
  const initialEndAt =
    leg.durationSeconds !== null
      ? new Date(Date.parse(initialStartAt) + leg.durationSeconds * 1000).toISOString()
      : initialStartAt

  return {
    initialStartAt,
    initialEndAt,
    initialTimezone: startPlace.timezone,
    initialEndTimezone: endPlace.timezone,
    initialStartPlace: startPlace,
    initialEndPlace: endPlace,
  }
}
