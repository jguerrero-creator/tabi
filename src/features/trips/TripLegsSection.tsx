import { useMemo } from 'react'
import { TravelModePicker } from '../../components/ui/TravelModePicker'
import { Spinner } from '../../components/ui/Spinner'
import { formatDuration, formatDistance } from '../../lib/duration'
import { computeFreeTimeBlocks, MIN_FREE_SECONDS_TO_SHOW } from '../../lib/freeTimeBlocks'
import { legKey } from '../../lib/tripLegs'
import type { TravelMode } from '../../lib/travelTime'
import { strings } from '../../lib/strings'
import type { Reservation } from '../../types/reservation'
import type { TripLeg } from './useTripLegs'

interface TripLegsSectionProps {
  reservations: Reservation[]
  legs: TripLeg[]
  loading: boolean
  error: string | null
  onModeChange: (key: string, mode: TravelMode) => void
}

export function TripLegsSection({ reservations, legs, loading, error, onModeChange }: TripLegsSectionProps) {
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
            return (
              <li key={key} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="truncate text-sm font-medium text-slate-900">
                  {from?.name ?? '—'} → {to?.name ?? '—'}
                </p>
                <div className="mb-2">
                  <p className="text-xs text-slate-500">{formatLeg(leg.durationSeconds, leg.distanceMeters)}</p>
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
                </div>
                <TravelModePicker value={leg.mode} onChange={(mode) => onModeChange(key, mode)} />
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
