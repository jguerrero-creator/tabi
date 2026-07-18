import { useState } from 'react'
import { TravelModePicker } from '../../components/ui/TravelModePicker'
import { Spinner } from '../../components/ui/Spinner'
import { legKey } from '../../lib/tripLegs'
import type { TravelMode } from '../../lib/travelTime'
import { strings } from '../../lib/strings'
import type { Reservation } from '../../types/reservation'
import { useTripLegs } from './useTripLegs'

interface TripLegsSectionProps {
  reservations: Reservation[]
}

export function TripLegsSection({ reservations }: TripLegsSectionProps) {
  const [modeByLeg, setModeByLeg] = useState<Record<string, TravelMode>>({})
  const { legs, loading, error } = useTripLegs(reservations, modeByLeg)

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
            return (
              <li key={key} className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="truncate text-sm font-medium text-slate-900">
                  {from?.name ?? '—'} → {to?.name ?? '—'}
                </p>
                <p className="mb-2 text-xs text-slate-500">{formatLeg(leg.durationSeconds, leg.distanceMeters)}</p>
                <TravelModePicker
                  value={leg.mode}
                  onChange={(mode) => setModeByLeg((prev) => ({ ...prev, [key]: mode }))}
                />
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

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}
