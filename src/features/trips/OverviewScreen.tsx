import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { Spinner } from '../../components/ui/Spinner'
import { formatInZone } from '../../lib/datetime'
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
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label={strings.common.back}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          ←
        </button>
        <div className="flex-1">
          <h1 className="truncate text-lg font-semibold text-slate-900">
            {trip?.name ?? strings.overview.title}
          </h1>
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
            <div className="flex rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium ${
                  activeTab === 'overview' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {strings.overview.overviewTab}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('planning')}
                className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium ${
                  activeTab === 'planning' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'
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

                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {strings.overview.menusTitle}
                  </h2>
                  <div className="grid grid-cols-2 gap-2">
                    <MenuLink to={`/trips/${tripId}/stay`} label={strings.menus.stay} />
                    <MenuLink to={`/trips/${tripId}/transport`} label={strings.menus.transport} />
                    <MenuLink to={`/trips/${tripId}/activities`} label={strings.menus.activities} />
                    <MenuLink label={strings.menus.budget} />
                  </div>
                </section>
              </>
            )}

            {activeTab === 'planning' && (
              <TripTimeline reservations={reservations} legs={legs} legsLoading={legsLoading} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function MenuLink({ to, label }: { to?: string; label: string }) {
  if (!to) {
    return (
      <span
        title={strings.overview.comingSoon}
        className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-center text-sm font-medium text-slate-400"
      >
        {label}
      </span>
    )
  }
  return (
    <Link
      to={to}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      {label}
    </Link>
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
