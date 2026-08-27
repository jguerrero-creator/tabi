import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { Button } from '../../components/ui/Button'
import { FormSheet } from '../../components/ui/FormSheet'
import { PlaceAutocompleteField, type PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { ReservationTypeIcon } from '../../components/ui/ReservationTypeIcon'
import { formatDateRangeLabel, formatDayPillLabel } from '../../lib/datetime'
import { extractPlanFromText } from '../../lib/extractPlan'
import {
  AddressNotFoundError,
  AddressSelectionCancelledError,
  fetchGeocodeByPlaceId,
  resolveAddress,
  type GeocodeResult,
} from '../../lib/geocode'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { NewReservation, Reservation } from '../../types/reservation'
import type { PlanItem } from '../../types/extractedPlan'
import { useTrip } from '../trips/useTrip'
import type { DayLocationInput } from '../trips/useTripDayLocations'
import { AddReservationModal } from './AddReservationModal'
import { mapExtractedReservation } from './mapExtractedReservation'
import { useAddressPicker } from './useAddressPicker'

interface ImportPlanModalProps {
  tripId: string
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
  onSaveDayLocation: (date: string, input: DayLocationInput) => Promise<void>
}

type ReviewStatus = 'pending' | 'saved' | 'discarded'

interface ReviewItem {
  id: string
  status: ReviewStatus
  data: PlanItem
}

// TABI-208: bulk import of a textual travel plan (a written itinerary, an exported AI-assistant
// conversation, or free-form notes) — extracts a LIST of decided day-locations/reservations in one
// call via the same Claude pipeline (api/extract-plan.ts), then walks the user through
// reviewing/editing/discarding each item one at a time before it's actually saved. Each item is
// confirmed through the SAME add flow used everywhere else (AddReservationModal for a reservation,
// the same geocode-on-submit pattern as DayPlannedLocation for a day-location) — no separate
// geocoding/validation/save logic, per the "shared templates everywhere" rule.
export function ImportPlanModal({ tripId, onClose, onCreate, onSaveDayLocation }: ImportPlanModalProps) {
  const { trip } = useTrip(tripId)
  const [text, setText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  // A manual "Edit & Save" tap on one row, independent of the automated queue below.
  const [manualEditingId, setManualEditingId] = useState<string | null>(null)
  // TABI-210: "Confirm all" fast path — a snapshot of pending item ids to auto-walk through one at
  // a time, each fired via AddReservationModal/PlanDayLocationEditor's own autoSubmit/autoStart
  // (so every geocoding/overlap/out-of-period/mismatch/required-field check still runs and still
  // pauses on its own dialog exactly as a manual save would — this only skips the "open the item
  // and press Save" step for a clean, unambiguous one). `confirmAllTotal` is fixed at the count
  // captured when the run started, so the progress label doesn't shift as items complete.
  const [confirmAllRemaining, setConfirmAllRemaining] = useState<string[] | null>(null)
  const [confirmAllTotal, setConfirmAllTotal] = useState(0)

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setText(event.target.value)
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileError(null)
    const reader = new FileReader()
    reader.onload = () => setText(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => {
      console.error('ImportPlanModal: failed to read uploaded file', reader.error)
      setFileError(strings.importPlan.fileErrorGeneric)
    }
    reader.readAsText(file)
  }

  async function handleExtract(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setExtracting(true)
    setError(null)
    try {
      const result = await extractPlanFromText(text, tripId)
      setItems(result.items.map((data) => ({ id: crypto.randomUUID(), status: 'pending' as const, data })))
    } catch (err) {
      logClientError('ImportPlanModal.handleExtract', err)
      setError(strings.importPlan.errorGeneric)
    } finally {
      setExtracting(false)
    }
  }

  function setItemStatus(id: string, status: ReviewStatus) {
    setItems((prev) => (prev ? prev.map((item) => (item.id === id ? { ...item, status } : item)) : prev))
  }

  const isConfirmAll = confirmAllRemaining !== null
  const activeId = confirmAllRemaining ? confirmAllRemaining[0] : manualEditingId
  const activeItem = items?.find((item) => item.id === activeId) ?? null

  // Called whichever way the active item's editor finishes — saved, or the user backed out of it
  // without saving. Either way it's done being "active": in a Confirm all run this advances to the
  // next queued item (or ends the run); for a manual single-item edit it just returns to the list.
  function finishActiveItem(outcome: 'saved' | 'skipped') {
    if (!activeItem) return
    if (outcome === 'saved') setItemStatus(activeItem.id, 'saved')
    if (isConfirmAll) {
      setConfirmAllRemaining((prev) => {
        if (!prev) return prev
        const next = prev.slice(1)
        return next.length > 0 ? next : null
      })
    } else {
      setManualEditingId(null)
    }
  }

  function handleConfirmAll() {
    const pendingIds = (items ?? []).filter((item) => item.status === 'pending').map((item) => item.id)
    if (pendingIds.length === 0) return
    setConfirmAllRemaining(pendingIds)
    setConfirmAllTotal(pendingIds.length)
  }

  function handleStopConfirmAll() {
    setConfirmAllRemaining(null)
  }

  if (activeItem && activeItem.data.kind === 'reservation') {
    const prefill = mapExtractedReservation(activeItem.data.reservation, trip?.currency ?? null)
    return (
      <AddReservationModal
        // Confirm all can move straight from one reservation-kind item to the next without ever
        // unmounting (no intermediate list render in between) — a stable key per item forces a
        // fresh mount each time, so autoSubmit's own "have I already fired" ref resets for every
        // item instead of staying latched true from the previous one.
        key={activeItem.id}
        tripId={tripId}
        defaultType={prefill.defaultType}
        requireTypeChoice={prefill.requireTypeChoice}
        defaultStaySubtype={prefill.defaultStaySubtype}
        defaultTransportSubtype={prefill.defaultTransportSubtype}
        initialName={prefill.initialName}
        initialStartAddressText={prefill.initialStartAddressText}
        initialEndAddressText={prefill.initialEndAddressText}
        initialStartDate={prefill.initialStartDate}
        initialStartTime={prefill.initialStartTime}
        initialEndDate={prefill.initialEndDate}
        initialEndTime={prefill.initialEndTime}
        initialPriceAmount={prefill.initialPriceAmount}
        initialConfirmationNumber={prefill.initialConfirmationNumber}
        initialNote={prefill.initialNote}
        extractionNotice
        // Never auto-submit when the extraction couldn't tell what type this is (requireTypeChoice)
        // — silently guessing a type would invent a fact the AI never actually had. Confirm all
        // still reaches this item, it just pauses here for a real manual Save like any other
        // ambiguity, instead of skipping straight through it.
        autoSubmit={isConfirmAll && !prefill.requireTypeChoice}
        onClose={() => finishActiveItem('skipped')}
        onCreate={async (input) => {
          const created = await onCreate(input)
          finishActiveItem('saved')
          return created
        }}
      />
    )
  }

  if (items) {
    const pendingCount = items.filter((item) => item.status === 'pending').length
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
        <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
            {confirmAllRemaining ? (
              <>
                <h2 className="text-lg font-semibold text-slate-900">
                  {strings.importPlan.confirmingProgress(confirmAllTotal - confirmAllRemaining.length + 1, confirmAllTotal)}
                </h2>
                <button type="button" onClick={handleStopConfirmAll} className="shrink-0 text-sm text-teal-700 underline">
                  {strings.importPlan.stopCta}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-slate-900">{strings.importPlan.reviewTitle(items.length)}</h2>
                <div className="flex shrink-0 items-center gap-3">
                  {pendingCount > 0 && (
                    <button type="button" onClick={handleConfirmAll} className="text-sm font-medium text-teal-700 underline">
                      {strings.importPlan.confirmAllCta}
                    </button>
                  )}
                  <Button type="button" variant="secondary" onClick={onClose}>
                    {strings.importPlan.doneCta}
                  </Button>
                </div>
              </>
            )}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
            {items.length === 0 && <p className="text-sm text-slate-500">{strings.importPlan.emptyState}</p>}
            {items.map((item) =>
              activeId === item.id && item.data.kind === 'dayLocation' ? (
                <PlanDayLocationEditor
                  key={item.id}
                  initialDate={item.data.date}
                  initialPlaceName={item.data.placeName}
                  autoStart={isConfirmAll}
                  onCancel={() => finishActiveItem('skipped')}
                  onSave={async (date, input) => {
                    await onSaveDayLocation(date, input)
                    finishActiveItem('saved')
                  }}
                />
              ) : (
                <PlanReviewItemRow
                  key={item.id}
                  item={item}
                  onEdit={() => setManualEditingId(item.id)}
                  onDiscard={() => setItemStatus(item.id, 'discarded')}
                  onUndo={() => setItemStatus(item.id, 'pending')}
                />
              ),
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <FormSheet
      title={strings.importPlan.title}
      onSubmit={handleExtract}
      onClose={onClose}
      cancelLabel={strings.importPlan.cancel}
      submitLabel={strings.importPlan.submit}
      submitting={extracting}
      submitDisabled={!text.trim()}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{strings.importPlan.textLabel}</span>
        <textarea
          id="import-plan-text"
          name="import-plan-text"
          value={text}
          onChange={handleTextChange}
          placeholder={strings.importPlan.textPlaceholder}
          rows={12}
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{strings.importPlan.fileLabel}</span>
        <input
          id="import-plan-file"
          name="import-plan-file"
          type="file"
          accept=".txt,.eml,text/plain,message/rfc822"
          onChange={handleFileSelect}
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
      </label>
      {fileError && <p className="text-sm text-red-600">{fileError}</p>}

      {extracting && <p className="text-sm text-slate-500">{strings.importPlan.extracting}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </FormSheet>
  )
}

function PlanReviewItemRow({
  item,
  onEdit,
  onDiscard,
  onUndo,
}: {
  item: ReviewItem
  onEdit: () => void
  onDiscard: () => void
  onUndo: () => void
}) {
  const { icon, title, dateLabel } = describePlanItem(item.data)

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-slate-200 p-3 ${
        item.status === 'discarded' ? 'opacity-50' : ''
      }`}
    >
      <div className="shrink-0 text-slate-500">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{title}</p>
        {dateLabel && <p className="truncate text-xs text-slate-500">{dateLabel}</p>}
      </div>
      {item.status === 'pending' && (
        <div className="flex shrink-0 gap-3">
          <button type="button" onClick={onEdit} className="text-xs font-medium text-teal-700 underline">
            {strings.importPlan.editSaveCta}
          </button>
          <button type="button" onClick={onDiscard} className="text-xs font-medium text-slate-500 underline">
            {strings.importPlan.discardCta}
          </button>
        </div>
      )}
      {item.status === 'saved' && (
        <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
          {strings.importPlan.savedChip}
        </span>
      )}
      {item.status === 'discarded' && (
        <button type="button" onClick={onUndo} className="shrink-0 text-xs font-medium text-teal-700 underline">
          {strings.importPlan.undoCta}
        </button>
      )}
    </div>
  )
}

function describePlanItem(data: PlanItem): { icon: ReactNode; title: string; dateLabel: string | null } {
  if (data.kind === 'dayLocation') {
    return {
      icon: <span aria-hidden="true">📍</span>,
      title: data.placeName,
      dateLabel: formatDayPillLabel(data.date),
    }
  }

  const { reservation } = data
  const startDateKey = extractDateKey(reservation.startDateTime)
  const endDateKey = extractDateKey(reservation.endDateTime)
  const startTime = extractTimeText(reservation.startDateTime)
  const endTime = extractTimeText(reservation.endDateTime)

  let dateLabel: string | null = null
  if (startDateKey && endDateKey && startDateKey !== endDateKey) {
    dateLabel = formatDateRangeLabel(startDateKey, endDateKey)
  } else if (startDateKey) {
    dateLabel = formatDayPillLabel(startDateKey)
  }
  if (dateLabel && startTime) {
    dateLabel += endTime && endTime !== startTime ? ` · ${startTime}–${endTime}` : ` · ${startTime}`
  }

  return {
    icon: <ReservationTypeIcon type={reservation.type ?? 'activity'} />,
    title: reservation.name ?? strings.importPlan.untitledReservation,
    dateLabel,
  }
}

// Deliberately never routed through `new Date(...)` — same reasoning as
// mapExtractedReservation's splitNaiveIsoDateTime: these are best-effort naive strings with no
// reliable timezone of their own, read as printed rather than reinterpreted in the browser's zone.
function extractDateKey(iso: string | null): string | null {
  if (!iso) return null
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function extractTimeText(iso: string | null): string | null {
  if (!iso) return null
  const match = iso.match(/T(\d{2}:\d{2})/)
  return match ? match[1] : null
}

// Mirrors DayPlannedLocation.tsx's own edit form (same geocode-on-submit path via
// resolveAddress/fetchGeocodeByPlaceId/useAddressPicker) but as a standalone editor for a single
// review-list row, with an editable date field seeded from the extraction instead of a fixed
// `dayKey` prop.
function PlanDayLocationEditor({
  initialDate,
  initialPlaceName,
  autoStart = false,
  onSave,
  onCancel,
}: {
  initialDate: string
  initialPlaceName: string
  // TABI-210: Confirm all's fast path for a day-location item — fires the same handleSave a
  // manual Save click would, once on mount, so a genuinely ambiguous address (resolveAddress's own
  // AddressCandidatePicker/AddressNotFoundError handling below) still pauses for the user exactly
  // as it would manually; a clean one just saves immediately.
  autoStart?: boolean
  onSave: (date: string, input: DayLocationInput) => Promise<void>
  onCancel: () => void
}) {
  const dateFieldId = useId()
  const [date, setDate] = useState(initialDate)
  const [text, setText] = useState(initialPlaceName)
  const [pendingPlace, setPendingPlace] = useState<(GeocodeResult & { placeName: string | null }) | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { candidates, requestPick, selectCandidate, cancelPick } = useAddressPicker()

  function handleTextChange(value: string) {
    setText(value)
    setPendingPlace(null)
  }

  async function handlePlaceSelect({ placeId, placeName, text: selectedText }: PlaceAutocompleteSelection) {
    setError(null)
    try {
      const result = await fetchGeocodeByPlaceId(placeId)
      setPendingPlace({ ...result, placeName: placeName ?? selectedText })
    } catch (err) {
      logClientError('PlanDayLocationEditor.handlePlaceSelect', err)
      setError(strings.dayLocation.errorGeneric)
    }
  }

  async function commit(input: DayLocationInput) {
    setSaving(true)
    try {
      await onSave(date, input)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('PlanDayLocationEditor.commit', err)
      setError(strings.dayLocation.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setError(null)
    if (!date) return

    if (pendingPlace) {
      await commit({
        placeName: pendingPlace.placeName ?? pendingPlace.formattedAddress,
        address: pendingPlace.formattedAddress,
        lat: pendingPlace.lat,
        lng: pendingPlace.lng,
        timezone: pendingPlace.timezone,
        city: pendingPlace.city,
      })
      return
    }

    if (!text.trim()) return

    setSaving(true)
    try {
      const resolved = await resolveAddress(text, requestPick)
      if (!resolved) return
      await commit({
        placeName: resolved.formattedAddress,
        address: resolved.formattedAddress,
        lat: resolved.lat,
        lng: resolved.lng,
        timezone: resolved.timezone,
        city: resolved.city,
      })
    } catch (err) {
      if (err instanceof AddressSelectionCancelledError) {
        setError(strings.addressPicker.selectionRequiredError)
      } else if (err instanceof AddressNotFoundError) {
        setError(strings.dayLocation.geocodeErrorNotFound)
      } else {
        logClientError('PlanDayLocationEditor.handleSave', err)
        setError(strings.dayLocation.errorGeneric)
      }
    } finally {
      setSaving(false)
    }
  }

  const hasAutoStartedRef = useRef(false)
  useEffect(() => {
    if (!autoStart || hasAutoStartedRef.current) return
    hasAutoStartedRef.current = true
    void handleSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount only, guarded by the ref above
  }, [autoStart])

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">{strings.importPlan.dateFieldLabel}</span>
        <input
          id={dateFieldId}
          name={dateFieldId}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </label>
      <PlaceAutocompleteField
        id={`plan-day-location-${initialDate}-${initialPlaceName}`}
        label={strings.dayLocation.label}
        value={text}
        onTextChange={handleTextChange}
        onPlaceSelect={handlePlaceSelect}
        placeholder={strings.dayLocation.placeholder}
      />
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          {strings.dayLocation.cancel}
        </Button>
        <Button type="button" onClick={handleSave} disabled={saving || (!text.trim() && !pendingPlace) || !date}>
          {saving ? strings.dayLocation.geocoding : strings.dayLocation.save}
        </Button>
      </div>
      {candidates && (
        <AddressCandidatePicker candidates={candidates} onSelect={selectCandidate} onCancel={cancelPick} />
      )}
    </div>
  )
}
