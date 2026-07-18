import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { Spinner } from '../../components/ui/Spinner'
import { formatInZone, formatTripDateRange } from '../../lib/datetime'
import { strings } from '../../lib/strings'
import type { TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'
import type { MapPoint } from '../../components/ui/MiniMap'
import { OverviewMap } from './OverviewMap'
import { TripLegsSection } from './TripLegsSection'
import { TripTimeline } from './TripTimeline'
import { useTrip } from './useTrip'
import { useTripLegs } from './useTripLegs'
import { useTripReservations } from './useTripReservations'

type OverviewTab = 'overview' | 'planning'

export function OverviewScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
  } = useTripReservations(tripId ?? '')
  const [activeTab, setActiveTab] = useState<OverviewTab>('overview')
  const [modeByLeg, setModeByLeg] = useState<Record<string, TravelMode>>({})
  // Lifted above both TripLegsSection and TripTimeline so switching tabs
  // doesn't re-trigger a billed Google Routes API call for the same legs.
  const { legs, loading: legsLoading, error: legsError } = useTripLegs(reservations, modeByLeg)

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError

  const points = useMemo(() => buildMapPoints(reservations), [reservations])
  const needsAttention = useMemo(() => buildNeedsAttention(reservations), [reservations])

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label={strings.common.back}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-slate-900">
            {trip?.name ?? strings.overview.title}
          </h1>
          {trip && formatTripDateRange(trip.start_date, trip.end_date) && (
            <p className="truncate text-xs text-slate-500">
              {formatTripDateRange(trip.start_date, trip.end_date)}
            </p>
          )}
        </div>
      </header>

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.overview.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.overview.errorLoading}</p>
        )}

        {!loading && !error && (
          <div className="space-y-5">
            <div className="flex rounded-full border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`flex-1 rounded-full px-3 py-1.5 text-center text-sm font-medium transition-colors ${
                  activeTab === 'overview' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {strings.overview.overviewTab}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('planning')}
                className={`flex-1 rounded-full px-3 py-1.5 text-center text-sm font-medium transition-colors ${
                  activeTab === 'planning' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {strings.overview.planningTab}
              </button>
            </div>

            {activeTab === 'overview' && (
              <>
                <OverviewMap points={points} />

                <TripLegsSection
                  reservations={reservations}
                  legs={legs}
                  loading={legsLoading}
                  error={legsError}
                  onModeChange={(key, mode) => setModeByLeg((prev) => ({ ...prev, [key]: mode }))}
                />

                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {strings.overview.needsAttentionTitle}
                  </h2>
                  {needsAttention.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                      {strings.overview.needsAttentionEmpty}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {needsAttention.map((reservation) => (
                        <MenuListRow
                          key={reservation.id}
                          to={`/reservations/${reservation.id}`}
                          type={reservation.type}
                          title={reservation.name}
                          status={reservation.status}
                          secondaryLabel={
                            reservation.start_at
                              ? formatInZone(reservation.start_at, reservation.start_timezone)
                              : null
                          }
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}

            {activeTab === 'planning' && (
              <TripTimeline reservations={reservations} legs={legs} legsLoading={legsLoading} legsError={legsError} />
            )}
          </div>
        )}
      </main>
    </>
  )
}

function buildMapPoints(reservations: Reservation[]): MapPoint[] {
  const points: MapPoint[] = []
  for (const reservation of reservations) {
    if (reservation.start_lat !== null && reservation.start_lng !== null) {
      points.push({
        lat: reservation.start_lat,
        lng: reservation.start_lng,
        label: reservation.start_place_name ?? reservation.name,
      })
    }
    if (reservation.type === 'transport' && reservation.end_lat !== null && reservation.end_lng !== null) {
      points.push({
        lat: reservation.end_lat,
        lng: reservation.end_lng,
        label: reservation.end_place_name ?? reservation.name,
      })
    }
  }
  return points
}

function buildNeedsAttention(reservations: Reservation[]): Reservation[] {
  return reservations
    .filter((reservation) => reservation.status === 'to_book')
    .sort((a, b) => (a.start_at ?? '￿').localeCompare(b.start_at ?? '￿'))
}
