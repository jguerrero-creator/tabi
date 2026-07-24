import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { groupByDate, UNSCHEDULED_KEY } from '../../components/menu/groupByDate'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { Spinner } from '../../components/ui/Spinner'
import { formatDayPillLabel, formatInZone, formatTripDateRange } from '../../lib/datetime'
import { strings } from '../../lib/strings'
import type { TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'
import type { TripDayLocation } from '../../types/dayLocation'
import type { Reminder } from '../../types/reminder'
import type { MapPoint } from '../../components/ui/MiniMap'
import { AddReservationModal } from '../reservations/AddReservationModal'
import { useCreateReservation } from '../reservations/useCreateReservation'
import { OverviewMap } from './OverviewMap'
import { RemindersSection } from './RemindersSection'
import { TripLegsSection, type LegQuickAddPayload } from './TripLegsSection'
import { TripTimeline } from './TripTimeline'
import { useTrip } from './useTrip'
import { useTripDayLocations } from './useTripDayLocations'
import { useTripDayNotes } from './useTripDayNotes'
import { useTripLegs } from './useTripLegs'
import { useTripReminders } from './useTripReminders'
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
    refetch: refetchReservations,
  } = useTripReservations(tripId ?? '')
  const { createReservation } = useCreateReservation(tripId ?? '')
  // TABI-54: "+" on a free-time timeline block opens the shared Add sheet
  // (defaulted to Activity, the one type with no required address/price)
  // pre-seeded with that block's own start time/timezone instead of asking
  // the user to re-derive it.
  const [quickAddBlock, setQuickAddBlock] = useState<{ startAt: string; timezone: string | null } | null>(null)
  // TABI-155: "+ Add" on a computed "Getting Around" leg opens the same shared
  // Add sheet, prefilled with that leg's departure/arrival and mode.
  const [legQuickAdd, setLegQuickAdd] = useState<LegQuickAddPayload | null>(null)
  // TABI-131: tab + selected day live in the URL (not local state) so that
  // navigating to a reservation's detail screen and back restores Planning
  // and its selected day instead of remounting to the Overview default.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: OverviewTab = searchParams.get('tab') === 'planning' ? 'planning' : 'overview'
  const selectedDayKey = searchParams.get('day')

  const setActiveTab = useCallback(
    (tab: OverviewTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (tab === 'planning') next.set('tab', 'planning')
          else next.delete('tab')
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setSelectedDayKey = useCallback(
    (day: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('day', day)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const [modeByLeg, setModeByLeg] = useState<Record<string, TravelMode>>({})
  const { locationsByDate: dayLocationsByKey, saveDayLocation, clearDayLocation } = useTripDayLocations(tripId ?? '')
  const { notesByDate: dayNotesByKey, saveDayNote, clearDayNote } = useTripDayNotes(tripId ?? '')
  // Lifted above both TripLegsSection and TripTimeline so switching tabs
  // doesn't re-trigger a billed Google Routes API call for the same legs.
  const {
    legs,
    loading: legsLoading,
    error: legsError,
  } = useTripLegs(reservations, dayLocationsByKey, modeByLeg)
  const { reminders, createReminder, deleteReminder } = useTripReminders(tripId ?? '')

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError

  const points = useMemo(
    () => buildMapPoints(reservations, dayLocationsByKey),
    [reservations, dayLocationsByKey],
  )
  const needsAttention = useMemo(() => buildNeedsAttention(reservations, reminders), [reservations, reminders])

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4 lg:hidden">
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
          <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6 lg:space-y-0">
            <div className="flex rounded-full border border-slate-200 bg-white p-1 lg:hidden">
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
                <div className="lg:sticky lg:top-6 lg:order-2">
                  <OverviewMap points={points} />
                </div>

                <div className="space-y-5 lg:order-1">
                  <TripLegsSection
                    reservations={reservations}
                    legs={legs}
                    loading={legsLoading}
                    error={legsError}
                    trip={trip}
                    onModeChange={(key, mode) => setModeByLeg((prev) => ({ ...prev, [key]: mode }))}
                    onQuickAddTransport={setLegQuickAdd}
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
                        {needsAttention.map((item) =>
                          item.kind === 'reservation' ? (
                            <MenuListRow
                              key={item.reservation.id}
                              to={`/reservations/${item.reservation.id}`}
                              type={item.reservation.type}
                              title={item.reservation.name}
                              status={item.reservation.status}
                              secondaryLabel={
                                item.reservation.start_at
                                  ? formatInZone(item.reservation.start_at, item.reservation.start_timezone)
                                  : null
                              }
                            />
                          ) : (
                            <li
                              key={item.reminder.id}
                              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">{item.reminder.title}</p>
                                <p className="text-xs text-slate-500">{formatDayPillLabel(item.reminder.date)}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => deleteReminder(item.reminder.id)}
                                aria-label={strings.reminders.remove}
                                className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                ✕
                              </button>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </section>

                  <RemindersSection onCreate={createReminder} />
                </div>
              </>
            )}

            {activeTab === 'planning' && (
              <div className="lg:col-span-2">
                <TripTimeline
                  trip={trip}
                  reservations={reservations}
                  legs={legs}
                  legsLoading={legsLoading}
                  legsError={legsError}
                  selectedDayKey={selectedDayKey}
                  onSelectDay={setSelectedDayKey}
                  dayLocationsByKey={dayLocationsByKey}
                  onSaveDayLocation={saveDayLocation}
                  onClearDayLocation={clearDayLocation}
                  dayNotesByKey={dayNotesByKey}
                  onSaveDayNote={saveDayNote}
                  onClearDayNote={clearDayNote}
                  onAddAtFreeBlock={setQuickAddBlock}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {quickAddBlock && (
        <AddReservationModal
          tripId={tripId ?? ''}
          defaultType="activity"
          initialStartAt={quickAddBlock.startAt}
          initialTimezone={quickAddBlock.timezone}
          onClose={() => setQuickAddBlock(null)}
          onCreate={async (input) => {
            const created = await createReservation(input)
            await refetchReservations()
            return created
          }}
        />
      )}

      {legQuickAdd && (
        <AddReservationModal
          tripId={tripId ?? ''}
          defaultType="transport"
          initialStartAt={legQuickAdd.initialStartAt}
          initialTimezone={legQuickAdd.initialTimezone}
          initialEndAt={legQuickAdd.initialEndAt}
          initialEndTimezone={legQuickAdd.initialEndTimezone}
          initialStartPlace={legQuickAdd.initialStartPlace}
          initialEndPlace={legQuickAdd.initialEndPlace}
          onClose={() => setLegQuickAdd(null)}
          onCreate={async (input) => {
            const created = await createReservation(input)
            await refetchReservations()
            return created
          }}
        />
      )}
    </>
  )
}

/**
 * Per day, prefers geocoded reservations over the day's planned location
 * (TABI-115) — a planned location is only an approximate stand-in for a day
 * with nothing booked yet, so a real reservation always wins once it exists.
 * Days with neither are simply absent from the map rather than plotted as a
 * gap. Unscheduled reservations aren't tied to a day (no planned-location
 * fallback applies to them) but their own geocoded points still show.
 */
function buildMapPoints(reservations: Reservation[], dayLocationsByKey: Map<string, TripDayLocation>): MapPoint[] {
  const groups = groupByDate(reservations, (reservation) => ({
    at: reservation.start_at,
    timezone: reservation.start_timezone,
  }))
  const groupsByKey = new Map(groups.map((group) => [group.dateKey, group]))

  // Sorted chronologically (dateKey is 'YYYY-MM-DD', so lexical order is date
  // order) rather than by Set insertion order, since `dayLocationsByKey` comes
  // from an unordered Supabase fetch — the map trace needs real chronological
  // order to connect points correctly, unlike the old markers-only version.
  const dayKeys = Array.from(
    new Set([
      ...dayLocationsByKey.keys(),
      ...groups.map((group) => group.dateKey).filter((key) => key !== UNSCHEDULED_KEY),
    ]),
  ).sort((a, b) => a.localeCompare(b))

  const points: MapPoint[] = []
  for (const dayKey of dayKeys) {
    const dayPoints = reservationPoints(groupsByKey.get(dayKey)?.items ?? [])
    if (dayPoints.length > 0) {
      points.push(...dayPoints)
      continue
    }
    const plannedLocation = dayLocationsByKey.get(dayKey)
    if (plannedLocation) {
      points.push({
        lat: plannedLocation.lat,
        lng: plannedLocation.lng,
        label: plannedLocation.place_name,
        status: null,
      })
    }
  }

  const unscheduledItems = groupsByKey.get(UNSCHEDULED_KEY)?.items ?? []
  points.push(...reservationPoints(unscheduledItems))

  return points
}

function reservationPoints(reservations: Reservation[]): MapPoint[] {
  const points: MapPoint[] = []
  for (const reservation of reservations) {
    if (reservation.start_lat !== null && reservation.start_lng !== null) {
      points.push({
        lat: reservation.start_lat,
        lng: reservation.start_lng,
        label: reservation.start_place_name ?? reservation.name,
        status: reservation.status,
      })
    }
    if (reservation.type === 'transport' && reservation.end_lat !== null && reservation.end_lng !== null) {
      points.push({
        lat: reservation.end_lat,
        lng: reservation.end_lng,
        label: reservation.end_place_name ?? reservation.name,
        status: reservation.status,
      })
    }
  }
  return points
}

type AttentionItem =
  | { kind: 'reservation'; sortKey: string; reservation: Reservation }
  | { kind: 'reminder'; sortKey: string; reminder: Reminder }

/**
 * Combines "to book" reservations with reminders (TABI-104) into one
 * urgency-sorted action list (TABI-53) — no full duplicate of every
 * reservation, just what actually needs the user's attention. Sorted as
 * plain strings: a reminder's `date` (YYYY-MM-DD) is always a prefix of a
 * same-day reservation's full `start_at` timestamp, so it naturally sorts
 * just before same-day bookings rather than needing a separate tie-break.
 */
function buildNeedsAttention(reservations: Reservation[], reminders: Reminder[]): AttentionItem[] {
  const items: AttentionItem[] = [
    ...reservations
      .filter((reservation) => reservation.status === 'to_book')
      .map((reservation): AttentionItem => ({ kind: 'reservation', sortKey: reservation.start_at ?? '￿', reservation })),
    ...reminders.map((reminder): AttentionItem => ({ kind: 'reminder', sortKey: reminder.date, reminder })),
  ]
  return items.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
}
