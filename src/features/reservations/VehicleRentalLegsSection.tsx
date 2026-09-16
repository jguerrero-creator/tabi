import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { formatDateLabel, formatTimeInZone } from '../../lib/datetime'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { Reservation } from '../../types/reservation'
import { AddVehicleRentalLegSheet } from './AddVehicleRentalLegSheet'
import { useVehicleRentalLegs, type VehicleRentalLegInput } from './useVehicleRentalLegs'

interface VehicleRentalLegsSectionProps {
  reservation: Reservation
}

/**
 * TABI-127: daily legs within a Vehicle Rental (at_disposal) reservation — a lightweight,
 * additive list scoped to this one reservation. Deliberately outside the reservation's own
 * edit <form> (which handles the rental's own pickup/drop-off), since each leg has its own
 * independent save/delete lifecycle via useVehicleRentalLegs rather than the form's single
 * handleSave.
 */
export function VehicleRentalLegsSection({ reservation }: VehicleRentalLegsSectionProps) {
  const { legs, loading, error, addLeg, deleteLeg } = useVehicleRentalLegs(reservation.id, reservation.trip_id)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleSave(input: VehicleRentalLegInput) {
    await addLeg(input)
    setAdding(false)
    showSavedToast(strings.common.saved)
  }

  async function handleDelete(legId: string) {
    if (!window.confirm(strings.vehicleRentalLegs.deleteConfirm)) return
    setDeletingId(legId)
    try {
      await deleteLeg(legId)
    } catch (err) {
      logClientError('VehicleRentalLegsSection.handleDelete', err)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {strings.vehicleRentalLegs.title}
        </h2>
        <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
          {strings.vehicleRentalLegs.addCta}
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
          <Spinner />
          {strings.vehicleRentalLegs.loading}
        </div>
      )}

      {!loading && error && <p className="text-sm text-red-600">{strings.vehicleRentalLegs.errorLoading}</p>}

      {!loading && !error && legs.length === 0 && (
        <p className="text-sm text-slate-500">{strings.vehicleRentalLegs.empty}</p>
      )}

      {!loading && !error && legs.length > 0 && (
        <ul className="space-y-2">
          {legs.map((leg) => (
            <li key={leg.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{formatDateLabel(leg.date)}</p>
                <button
                  type="button"
                  onClick={() => handleDelete(leg.id)}
                  disabled={deletingId === leg.id}
                  aria-label={`${strings.vehicleRentalLegs.delete} ${formatDateLabel(leg.date)}`}
                  className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  {strings.vehicleRentalLegs.delete}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {strings.vehicleRentalLegs.departureLabel}: {leg.departure_place_name} ·{' '}
                {formatTimeInZone(leg.departure_at, leg.departure_timezone)}
              </p>
              <p className="text-xs text-slate-500">
                {strings.vehicleRentalLegs.arrivalLabel}: {leg.arrival_place_name} ·{' '}
                {formatTimeInZone(leg.arrival_at, leg.arrival_timezone)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddVehicleRentalLegSheet reservation={reservation} onSave={handleSave} onClose={() => setAdding(false)} />
      )}
    </section>
  )
}
