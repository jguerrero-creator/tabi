import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { strings } from '../../lib/strings'
import type { Trip } from '../../types/trip'
import { CreateTripModal } from './CreateTripModal'
import { useTrips } from './useTrips'

export function TripsListScreen() {
  const { trips, loading, error, createTrip } = useTrips()
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { upcoming, past } = useMemo(() => splitByDate(trips), [trips])

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4">
        <h1 className="text-lg font-semibold text-slate-900">{strings.home.title}</h1>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          aria-label={strings.home.createCta}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-xl leading-none text-white hover:bg-teal-700"
        >
          +
        </button>
      </header>

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.home.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.home.errorLoading}</p>
        )}

        {!loading && !error && trips.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.home.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.home.emptyBody}</p>
            <Button onClick={() => setShowCreateModal(true)}>{strings.home.createCta}</Button>
          </div>
        )}

        {!loading && !error && trips.length > 0 && (
          <div className="space-y-6">
            <TripSection title={strings.sections.upcoming} trips={upcoming} />
            <TripSection title={strings.sections.past} trips={past} />
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateTripModal onClose={() => setShowCreateModal(false)} onCreate={createTrip} />
      )}
    </div>
  )
}

function TripSection({ title, trips }: { title: string; trips: Trip[] }) {
  if (trips.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {trips.map((trip) => (
          <li key={trip.id}>
            <Link to={`/trips/${trip.id}`} className="block px-4 py-3 hover:bg-slate-50">
              <p className="text-sm font-medium text-slate-900">{trip.name}</p>
              {trip.destinations.length > 0 && (
                <p className="text-xs text-slate-500">{trip.destinations.join(', ')}</p>
              )}
              <p className="text-xs text-slate-500">{formatDateRange(trip.start_date, trip.end_date)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function splitByDate(trips: Trip[]) {
  const today = new Date().toISOString().slice(0, 10)
  const upcoming: Trip[] = []
  const past: Trip[] = []

  for (const trip of trips) {
    const isPast = trip.end_date !== null && trip.end_date < today
    if (isPast) {
      past.push(trip)
    } else {
      upcoming.push(trip)
    }
  }

  return { upcoming, past }
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return 'Dates not set'
  if (start && end) return `${start} → ${end}`
  return start ?? end ?? ''
}
