import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { groupByDate, UNSCHEDULED_KEY } from '../../components/menu/groupByDate'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { Spinner } from '../../components/ui/Spinner'
import { formatDayPillLabel, formatInZone, formatTripDateRange } from '../../lib/datetime'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import { useProfile } from '../../lib/useProfile'
import type { Reservation } from '../../types/reservation'
import type { TripDayLocation } from '../../types/dayLocation'
import type { Reminder } from '../../types/reminder'
import type { MapPoint } from '../../components/ui/MiniMap'
import { AddReservationModal, type ResolvedPlace } from '../reservations/AddReservationModal'
import { ImportConfirmationModal } from '../reservations/ImportConfirmationModal'
import { ImportPlanModal } from '../reservations/ImportPlanModal'
import { NearbyPlacesMapModal } from '../reservations/NearbyPlacesMapModal'
import { QuickAddModal } from '../reservations/QuickAddModal'
import { SavePlaceModal } from '../reservations/SavePlaceModal'
import { useCreateReservation } from '../reservations/useCreateReservation'
import { OverviewMap } from './OverviewMap'
import type { FreeBlockAddPayload } from './DayColumn'
import { RemindersSection } from './RemindersSection'
import { TripLegsSection, type LegQuickAddPayload } from './TripLegsSection'
import { TripTimeline } from './TripTimeline'
import { useTrip } from './useTrip'
import { useTripDayLocations } from './useTripDayLocations'
import { useTripDayNotes } from './useTripDayNotes'
import { useTripLegs } from './useTripLegs'
import { useTripLegTravelModes } from './useTripLegTravelModes'
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
  // TABI-24: when the block's day has a resolvable contextual location (active
  // accommodation, or the day's planned location), a nearby-places map is shown
  // first — a small step machine, same shape as ActivitiesMenuScreen's AddStep —
  // before falling into the same TABI-54 blank form as the manual fallback.
  const [quickAddBlock, setQuickAddBlock] = useState<FreeBlockAddPayload | null>(null)
  const [quickAddStep, setQuickAddStep] = useState<'places' | 'form' | null>(null)
  const [quickAddPlace, setQuickAddPlace] = useState<ResolvedPlace | null>(null)

  function handleAddAtFreeBlock(input: FreeBlockAddPayload) {
    setQuickAddBlock(input)
    setQuickAddPlace(null)
    setQuickAddStep(input.contextLocation ? 'places' : 'form')
  }

  function closeQuickAdd() {
    setQuickAddBlock(null)
    setQuickAddStep(null)
    setQuickAddPlace(null)
  }

  // TABI-21: a place picked from the nearby-places map lands straight on the
  // timeline — no intermediate form step, since the block already supplies the
  // start time/timezone and the map result supplies everything else an Activity
  // needs. Falls back to the full form (pre-filled with the picked place) rather
  // than failing silently if the direct save errors, so the user's selection
  // isn't lost.
  async function handleSelectFreeBlockPlace(place: ResolvedPlace) {
    if (!quickAddBlock) return
    try {
      await createReservation({
        type: 'activity',
        status: 'to_book',
        name: place.placeName ?? place.formattedAddress,
        start_at: quickAddBlock.startAt,
        start_timezone: quickAddBlock.timezone,
        start_address: place.formattedAddress,
        start_lat: place.lat,
        start_lng: place.lng,
        start_place_name: place.placeName,
        start_city: place.city,
        place_google_id: place.placeDetails?.googlePlaceId ?? null,
        place_rating: place.placeDetails?.rating ?? null,
        place_user_ratings_total: place.placeDetails?.userRatingsTotal ?? null,
        place_photo_ref: place.placeDetails?.photoRef ?? null,
        place_category: place.placeDetails?.category ?? null,
      })
      await refetchReservations()
      showSavedToast(strings.common.saved)
      closeQuickAdd()
    } catch (err) {
      logClientError('OverviewScreen.handleSelectFreeBlockPlace', err)
      setQuickAddPlace(place)
      setQuickAddStep('form')
    }
  }
  // TABI-155: "+ Add" on a computed "Getting Around" leg opens the same shared
  // Add sheet, prefilled with that leg's departure/arrival and mode.
  const [legQuickAdd, setLegQuickAdd] = useState<LegQuickAddPayload | null>(null)
  // TABI-12: entry point for the extraction-review flow — paste-text, email upload (TABI-15),
  // PDF upload (TABI-23), and photo upload (TABI-58) all live inside ImportConfirmationModal.
  const [showImportModal, setShowImportModal] = useState(false)
  // TABI-208: bulk import of a textual travel plan (a written itinerary, an exported AI
  // planning conversation, or notes) — extracts a LIST of decided day-locations/reservations in
  // one call, reviewed/edited one at a time via ImportPlanModal before any of it is saved.
  const [showImportPlanModal, setShowImportPlanModal] = useState(false)
  // TABI-194: ultra-fast placeholder creation — a single free-text line through the same
  // extraction pipeline/review screen as ImportConfirmationModal, via QuickAddModal.
  const [showQuickAddModal, setShowQuickAddModal] = useState(false)
  // TABI-20: "spot a place on-site, save it as To book" — a global entry point (not
  // tied to a specific Planning day/free-block, unlike TABI-24's nearby-places flow)
  // since the traveler isn't necessarily looking at their itinerary when they spot it.
  const [showSavePlaceModal, setShowSavePlaceModal] = useState(false)
  // TABI-99: client-side entitlement check, display-only (greys out the trigger and
  // explains why) — the server-side gate on /api/extract-reservation and /api/import-url
  // is what actually enforces this. `free.aiAccess` is true today (TABI-177), so this never
  // disables the buttons as a side effect until a real paid tier changes that flag.
  const { profile, can } = useProfile()
  const aiAccessDenied = profile !== null && !can({ feature: 'aiAccess' })
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

  // TABI-200: persists the chosen mode (and its computed/failed result) per leg so it
  // survives a reload instead of resetting to "no mode chosen" on every Overview visit.
  const { stateByKey: legModeState, setLegMode, setLegResult, dismissLegError } = useTripLegTravelModes(tripId ?? '')
  const { locationsByDate: dayLocationsByKey, saveDayLocation, clearDayLocation } = useTripDayLocations(tripId ?? '')
  const { notesByDate: dayNotesByKey, saveDayNote, clearDayNote } = useTripDayNotes(tripId ?? '')
  // Lifted above both TripLegsSection and TripTimeline so switching tabs
  // doesn't re-trigger a billed Google Routes API call for the same legs.
  const {
    legs,
    loading: legsLoading,
    error: legsError,
  } = useTripLegs(reservations, dayLocationsByKey, legModeState, setLegResult)
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
          <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
            <div className="flex justify-end gap-2 lg:col-span-2">
              <button
                type="button"
                onClick={() => setShowSavePlaceModal(true)}
                className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {strings.savePlace.triggerLabel}
              </button>
              <button
                type="button"
                onClick={() => setShowQuickAddModal(true)}
                disabled={aiAccessDenied}
                title={aiAccessDenied ? strings.overview.aiAccessRequired : undefined}
                className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {strings.quickAdd.triggerLabel}
              </button>
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                disabled={aiAccessDenied}
                title={aiAccessDenied ? strings.overview.aiAccessRequired : undefined}
                className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {strings.importConfirmation.triggerLabel}
              </button>
              <button
                type="button"
                onClick={() => setShowImportPlanModal(true)}
                disabled={aiAccessDenied}
                title={aiAccessDenied ? strings.overview.aiAccessRequired : undefined}
                className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {strings.importPlan.triggerLabel}
              </button>
            </div>

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
                    onModeChange={setLegMode}
                    onDismissError={dismissLegError}
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
                  onAddAtFreeBlock={handleAddAtFreeBlock}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {quickAddStep === 'places' && quickAddBlock?.contextLocation && (
        <NearbyPlacesMapModal
          center={quickAddBlock.contextLocation}
          onSelect={handleSelectFreeBlockPlace}
          onSkip={() => {
            setQuickAddPlace(null)
            setQuickAddStep('form')
          }}
          onCancel={closeQuickAdd}
        />
      )}

      {quickAddStep === 'form' && quickAddBlock && (
        <AddReservationModal
          tripId={tripId ?? ''}
          defaultType="activity"
          requireTypeChoice={!quickAddPlace}
          initialStartAt={quickAddBlock.startAt}
          initialTimezone={quickAddBlock.timezone}
          initialStartPlace={quickAddPlace}
          initialName={quickAddPlace?.placeName ?? null}
          onClose={closeQuickAdd}
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

      {showImportModal && (
        <ImportConfirmationModal
          tripId={tripId ?? ''}
          onClose={() => setShowImportModal(false)}
          onCreate={async (input) => {
            const created = await createReservation(input)
            await refetchReservations()
            return created
          }}
        />
      )}

      {showImportPlanModal && (
        <ImportPlanModal
          tripId={tripId ?? ''}
          onClose={() => setShowImportPlanModal(false)}
          onCreate={async (input) => {
            const created = await createReservation(input)
            await refetchReservations()
            return created
          }}
          onSaveDayLocation={saveDayLocation}
        />
      )}

      {showQuickAddModal && (
        <QuickAddModal
          tripId={tripId ?? ''}
          onClose={() => setShowQuickAddModal(false)}
          onCreate={async (input) => {
            const created = await createReservation(input)
            await refetchReservations()
            return created
          }}
        />
      )}

      {showSavePlaceModal && (
        <SavePlaceModal
          tripId={tripId ?? ''}
          onClose={() => setShowSavePlaceModal(false)}
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
