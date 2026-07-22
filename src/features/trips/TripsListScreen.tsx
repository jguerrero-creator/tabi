import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Spinner } from '../../components/ui/Spinner'
import { countryName } from '../../lib/countries'
import { strings } from '../../lib/strings'
import type { Trip } from '../../types/trip'
import { TripFormModal } from './TripFormModal'
import { useTrips } from './useTrips'

export function TripsListScreen() {
  const { trips, loading, error, createTrip, updateTrip, deleteTrip } = useTrips()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null)
  const [deletingTrip, setDeletingTrip] = useState<Trip | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { upcoming, past } = useMemo(() => splitByDate(trips), [trips])

  async function handleConfirmDelete() {
    if (!deletingTrip) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteTrip(deletingTrip.id)
      setDeletingTrip(null)
    } catch {
      setDeleteError(strings.deleteTrip.errorGeneric)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 lg:max-w-5xl">
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

      <main className="px-4 py-4 lg:px-8">
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
            <TripSection
              title={strings.sections.upcoming}
              trips={upcoming}
              onEdit={setEditingTrip}
              onDelete={setDeletingTrip}
            />
            <TripSection
              title={strings.sections.past}
              trips={past}
              onEdit={setEditingTrip}
              onDelete={setDeletingTrip}
            />
          </div>
        )}

        <footer className="py-8 text-center">
          <Link to="/privacy" className="text-xs text-slate-400 underline hover:text-slate-600">
            {strings.home.privacyLink}
          </Link>
        </footer>
      </main>

      {showCreateModal && (
        <TripFormModal onClose={() => setShowCreateModal(false)} onSubmit={createTrip} />
      )}

      {editingTrip && (
        <TripFormModal
          trip={editingTrip}
          onClose={() => setEditingTrip(null)}
          onSubmit={(input) => updateTrip(editingTrip.id, input)}
        />
      )}

      {deletingTrip && (
        <ConfirmDialog
          title={strings.deleteTrip.confirmTitle}
          message={deleteError ? `${strings.deleteTrip.confirmMessage} ${deleteError}` : strings.deleteTrip.confirmMessage}
          confirmLabel={strings.deleteTrip.confirmCta}
          cancelLabel={strings.deleteTrip.cancelCta}
          onConfirm={handleConfirmDelete}
          onCancel={() => {
            setDeletingTrip(null)
            setDeleteError(null)
          }}
          confirming={deleting}
        />
      )}
    </div>
  )
}

function TripSection({
  title,
  trips,
  onEdit,
  onDelete,
}: {
  title: string
  trips: Trip[]
  onEdit: (trip: Trip) => void
  onDelete: (trip: Trip) => void
}) {
  if (trips.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid lg:grid-cols-3 lg:gap-4 lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
        {trips.map((trip) => (
          <li
            key={trip.id}
            className="flex items-center lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200 lg:bg-white"
          >
            <Link to={`/trips/${trip.id}`} className="block flex-1 px-4 py-3 hover:bg-slate-50">
              <p className="text-sm font-medium text-slate-900">{trip.name}</p>
              {trip.destinations.length > 0 && (
                <p className="text-xs text-slate-500">
                  {trip.destinations.map((code) => countryName(code) ?? code).join(', ')}
                </p>
              )}
              <p className="text-xs text-slate-500">{formatDateRange(trip.start_date, trip.end_date)}</p>
            </Link>
            <button
              type="button"
              onClick={() => onEdit(trip)}
              aria-label={strings.editTrip.editCta}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => onDelete(trip)}
              aria-label={strings.deleteTrip.deleteCta}
              className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-red-600"
            >
              🗑
            </button>
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
