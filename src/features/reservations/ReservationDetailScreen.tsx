import { APIProvider } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import type { MapPoint } from '../../components/ui/MiniMap'
import { MiniMap } from '../../components/ui/MiniMap'
import type { PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { PlaceAutocompleteField } from '../../components/ui/PlaceAutocompleteField'
import { ReservationIcon } from '../../components/ui/ReservationTypeIcon'
import { Spinner } from '../../components/ui/Spinner'
import { StatusPicker } from '../../components/ui/StatusPicker'
import {
  addDurationToTime,
  durationHoursMinutes,
  formatInZone,
  localDateKey,
  localTimeKey,
  localTimeZone,
  zonedTimeToUtc,
} from '../../lib/datetime'
import {
  AddressNotFoundError,
  AddressSelectionCancelledError,
  fetchGeocodeByPlaceId,
  resolveAddress,
  type GeocodeCandidate,
  type GeocodeResult,
} from '../../lib/geocode'
import { logClientError } from '../../lib/logError'
import { placePhotoUrl } from '../../lib/placesSearch'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { Reservation, ReservationStatus } from '../../types/reservation'
import { addDays, nightsBetween } from '../stay/computeAccommodationGaps'
import { useTrip } from '../trips/useTrip'
import { transportRouteName } from './transportRouteName'
import { extendedTripRange, outOfPeriodField, type OutOfPeriodField } from './tripPeriod'
import { useAddressPicker } from './useAddressPicker'
import { useReservation } from './useReservation'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

const STAY_CHECKIN_DATE_FIELD_ID = 'reservation-checkin-date'
const STAY_CHECKOUT_DATE_FIELD_ID = 'reservation-checkout-date'
const TRANSPORT_START_DATE_FIELD_ID = 'reservation-transport-start-date'
const TRANSPORT_END_DATE_FIELD_ID = 'reservation-transport-end-date'

type ResolvedPlace = GeocodeResult & { placeName: string | null }

type DatedCandidate = {
  start_at: string | null
  end_at: string | null
  start_timezone: string | null
  end_timezone: string | null
}

export function ReservationDetailScreen() {
  const { reservationId } = useParams<{ reservationId: string }>()
  const navigate = useNavigate()
  const { reservation, loading, error, updateReservation, deleteReservation } = useReservation(
    reservationId ?? '',
  )

  if (loading) {
    return (
      <ScreenShell onBack={() => navigate(-1)}>
        <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
          <Spinner />
          <p className="text-sm">{strings.reservationDetail.loading}</p>
        </div>
      </ScreenShell>
    )
  }

  if (error) {
    return (
      <ScreenShell onBack={() => navigate(-1)}>
        <p className="py-16 text-center text-sm text-red-600">{strings.reservationDetail.errorLoading}</p>
      </ScreenShell>
    )
  }

  if (!reservation) {
    return (
      <ScreenShell onBack={() => navigate(-1)}>
        <p className="py-16 text-center text-sm text-slate-500">{strings.reservationDetail.notFound}</p>
      </ScreenShell>
    )
  }

  return (
    <ReservationDetailBody
      reservation={reservation}
      onBack={() => navigate(-1)}
      onUpdate={updateReservation}
      onDelete={async () => {
        await deleteReservation()
        navigate(-1)
      }}
    />
  )
}

function ScreenShell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          aria-label={strings.common.back}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          ←
        </button>
      </header>
      <main className="px-4 py-4">{children}</main>
    </div>
  )
}

interface ReservationDetailBodyProps {
  reservation: Reservation
  onBack: () => void
  onUpdate: (patch: Partial<Reservation>) => Promise<Reservation>
  onDelete: () => Promise<void>
}

function ReservationDetailBody({ reservation, onBack, onUpdate, onDelete }: ReservationDetailBodyProps) {
  // TABI-16: currency is inherited from the trip, never picked per reservation — this screen
  // needs the trip to fill in a reservation saved without a price (price_currency still null).
  const { trip, updateDates: updateTripDates } = useTrip(reservation.trip_id)
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { candidates, requestPick, selectCandidate, cancelPick } = useAddressPicker()
  // Bug: "ReservationDetailScreen.tsx n'a aucun contrôle 'Outside trip dates'" — parity with
  // AddReservationModal's TABI-113 check, which the create flow already enforces. Editing a
  // Stay/Transport date on an existing reservation to fall outside the trip's dates was
  // silently accepted; this gates the save behind the same explicit confirm.
  const [outOfPeriodConfirm, setOutOfPeriodConfirm] = useState<{
    patch: Partial<Reservation>
    field: OutOfPeriodField
    candidate: DatedCandidate
  } | null>(null)

  const [name, setName] = useState(reservation.name)
  const [note, setNote] = useState(reservation.note ?? '')
  const [priceAmount, setPriceAmount] = useState(reservation.price_amount?.toString() ?? '')
  const [confirmationNumber, setConfirmationNumber] = useState(reservation.confirmation_number ?? '')
  const [parkingIncluded, setParkingIncluded] = useState<boolean | null>(reservation.stay_parking_included)
  const [checkInDeadline, setCheckInDeadline] = useState(reservation.stay_check_in_deadline?.slice(0, 5) ?? '')
  // TABI-144: check-in/check-out time may be a standard default (see AddReservationModal) —
  // editable here, with the original snapshot kept to detect an actual edit before clearing
  // the "default" flag (mirrors the address dirty-check in geocodeIfChanged below).
  const [checkInTime, setCheckInTime] = useState(() =>
    reservation.type === 'stay' && reservation.start_at
      ? localTimeKey(reservation.start_at, reservation.start_timezone)
      : '',
  )
  const [checkOutTime, setCheckOutTime] = useState(() =>
    reservation.type === 'stay' && reservation.end_at
      ? localTimeKey(reservation.end_at, reservation.end_timezone)
      : '',
  )
  const initialCheckInTimeRef = useRef(checkInTime)
  const initialCheckOutTimeRef = useRef(checkOutTime)
  // TABI-160: dates were previously not editable here at all — reuses the same "number of
  // nights" derivation as AddReservationModal (TABI-112) rather than asking for a checkout
  // date directly, with the same initial-snapshot dirty-check pattern as the times above.
  const [checkInDate, setCheckInDate] = useState(() =>
    reservation.type === 'stay' && reservation.start_at
      ? localDateKey(reservation.start_at, reservation.start_timezone)
      : '',
  )
  const [checkOutDate, setCheckOutDate] = useState(() =>
    reservation.type === 'stay' && reservation.end_at
      ? localDateKey(reservation.end_at, reservation.end_timezone)
      : '',
  )
  const [nights, setNights] = useState(() =>
    reservation.type === 'stay' && reservation.start_at && reservation.end_at
      ? String(
          nightsBetween(
            localDateKey(reservation.start_at, reservation.start_timezone),
            localDateKey(reservation.end_at, reservation.end_timezone),
          ),
        )
      : '',
  )
  const [manualEndDate, setManualEndDate] = useState(false)
  const initialCheckInDateRef = useRef(checkInDate)
  const initialCheckOutDateRef = useRef(checkOutDate)
  // TABI-182: symmetric to the TABI-160 Stay block above, but for Activity — previously there
  // was no UI at all to edit an Activity's start date/time or add a missing end/duration.
  const [activityStartDate, setActivityStartDate] = useState(() =>
    reservation.type === 'activity' && reservation.start_at
      ? localDateKey(reservation.start_at, reservation.start_timezone)
      : '',
  )
  const [activityStartTime, setActivityStartTime] = useState(() =>
    reservation.type === 'activity' && reservation.start_at
      ? localTimeKey(reservation.start_at, reservation.start_timezone)
      : '',
  )
  const [durationHours, setDurationHours] = useState(() => {
    if (reservation.type !== 'activity' || !reservation.start_at || !reservation.end_at) return ''
    return String(durationHoursMinutes(reservation.start_at, reservation.end_at).hours)
  })
  const [durationMinutes, setDurationMinutes] = useState(() => {
    if (reservation.type !== 'activity' || !reservation.start_at || !reservation.end_at) return ''
    return String(durationHoursMinutes(reservation.start_at, reservation.end_at).minutes)
  })
  // TABI-211: Transport had no date/time editing at all — same "editable dates in the detail
  // screen" gap TABI-160 already closed for Stay, mirrored here: separate date/time state per
  // leg, with the same initial-snapshot dirty-check as Stay's checkInTime/checkOutTime so editing
  // something else (price, note…) without touching a defaulted time doesn't clear its "Default"
  // badge. A vehicle rental (at_disposal) only ever collects dates, same as at creation (TABI-123).
  const isTransportAtDisposal = reservation.type === 'transport' && reservation.transport_subtype === 'at_disposal'
  const transportLegLabels = isTransportAtDisposal
    ? strings.reservationLegLabelsAtDisposal
    : strings.reservationLegLabels.transport
  const [transportStartDate, setTransportStartDate] = useState(() =>
    reservation.type === 'transport' && reservation.start_at
      ? localDateKey(reservation.start_at, reservation.start_timezone)
      : '',
  )
  const [transportStartTime, setTransportStartTime] = useState(() =>
    reservation.type === 'transport' && reservation.start_at
      ? localTimeKey(reservation.start_at, reservation.start_timezone)
      : '',
  )
  const [transportEndDate, setTransportEndDate] = useState(() =>
    reservation.type === 'transport' && reservation.end_at
      ? localDateKey(reservation.end_at, reservation.end_timezone)
      : '',
  )
  const [transportEndTime, setTransportEndTime] = useState(() =>
    reservation.type === 'transport' && reservation.end_at
      ? localTimeKey(reservation.end_at, reservation.end_timezone)
      : '',
  )
  const initialTransportStartDateRef = useRef(transportStartDate)
  const initialTransportStartTimeRef = useRef(transportStartTime)
  const initialTransportEndDateRef = useRef(transportEndDate)
  const initialTransportEndTimeRef = useRef(transportEndTime)
  const [startAddress, setStartAddress] = useState(reservation.start_address ?? '')
  const [endAddress, setEndAddress] = useState(reservation.end_address ?? '')
  const [startPlace, setStartPlace] = useState<ResolvedPlace | null>(null)
  const [endPlace, setEndPlace] = useState<ResolvedPlace | null>(null)

  // TABI-122: point-to-point transport has no free-text name — it's derived from the route.
  const isAutoNamedTransport =
    reservation.type === 'transport' && reservation.transport_subtype === 'point_to_point'

  const points: MapPoint[] = []
  if (reservation.start_lat !== null && reservation.start_lng !== null) {
    points.push({
      lat: reservation.start_lat,
      lng: reservation.start_lng,
      label: reservation.start_place_name ?? strings.reservationDetail.startLabel,
      status: reservation.status,
    })
  }
  if (
    reservation.type === 'transport' &&
    reservation.end_lat !== null &&
    reservation.end_lng !== null
  ) {
    points.push({
      lat: reservation.end_lat,
      lng: reservation.end_lng,
      label: reservation.end_place_name ?? strings.reservationDetail.endLabel,
      status: reservation.status,
    })
  }

  // Mirrors AddReservationModal's TABI-112 effect: while manualEndDate is off, checkout follows
  // check-in + nights. Invalid/blank nights leave the last valid checkOutDate alone rather than
  // clearing it, since — unlike the add flow — there's always an existing date to fall back to.
  useEffect(() => {
    if (reservation.type !== 'stay' || manualEndDate) return
    const n = Number(nights)
    if (!checkInDate || nights.trim() === '' || !Number.isFinite(n) || n < 1) return
    setCheckOutDate(addDays(checkInDate, Math.trunc(n)))
  }, [reservation.type, manualEndDate, checkInDate, nights])

  async function handleStatusChange(status: ReservationStatus) {
    await onUpdate({ status })
  }

  // Preview-only: the resolved place name is only known once an address has been
  // re-geocoded (startPlace/endPlace); until then, fall back to the reservation's
  // existing place name as long as the address text hasn't been edited.
  function previewLegPlaceName(
    resolved: ResolvedPlace | null,
    currentAddress: string,
    originalAddress: string | null,
    originalPlaceName: string | null,
  ): string | null {
    if (resolved) return resolved.placeName
    return currentAddress.trim() === (originalAddress ?? '').trim() ? originalPlaceName : null
  }

  function handleStartAddressChange(text: string) {
    setStartAddress(text)
    setStartPlace(null)
  }

  function handleEndAddressChange(text: string) {
    setEndAddress(text)
    setEndPlace(null)
  }

  async function handleStartPlaceSelect({ placeId, placeName }: PlaceAutocompleteSelection) {
    setGeocoding(true)
    try {
      const result = await fetchGeocodeByPlaceId(placeId)
      setStartPlace({ ...result, placeName })
    } catch {
      // Fall back silently — handleSave's free-text geocodeIfChanged() covers this.
    } finally {
      setGeocoding(false)
    }
  }

  async function handleEndPlaceSelect({ placeId, placeName }: PlaceAutocompleteSelection) {
    setGeocoding(true)
    try {
      const result = await fetchGeocodeByPlaceId(placeId)
      setEndPlace({ ...result, placeName })
    } catch {
      // Fall back silently — handleSave's free-text geocodeIfChanged() covers this.
    } finally {
      setGeocoding(false)
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    // TABI-160: dates/nights validated and folded into the patch alongside the TABI-144 times —
    // only include start_at/end_at when something actually changed, same dirty-check shape as
    // the rest of this form.
    let stayDatePatch: Partial<Reservation> = {}
    if (reservation.type === 'stay' && reservation.start_at && reservation.end_at) {
      if (!manualEndDate && (nights.trim() === '' || Number(nights) < 1)) {
        setFormError(strings.reservationDetail.errorNightsRequired)
        return
      }

      const effectiveCheckInTime = checkInTime.trim() || initialCheckInTimeRef.current
      const effectiveCheckOutTime = checkOutTime.trim() || initialCheckOutTimeRef.current
      const effectiveCheckInDate = checkInDate || initialCheckInDateRef.current
      const effectiveCheckOutDate = checkOutDate || initialCheckOutDateRef.current
      const newStartAt = zonedTimeToUtc(
        effectiveCheckInDate,
        effectiveCheckInTime,
        reservation.start_timezone ?? localTimeZone(),
      )
      const newEndAt = zonedTimeToUtc(
        effectiveCheckOutDate,
        effectiveCheckOutTime,
        reservation.end_timezone ?? localTimeZone(),
      )
      if (newEndAt <= newStartAt) {
        setFormError(strings.reservationDetail.errorEndBeforeStart)
        return
      }

      const startDateChanged = effectiveCheckInDate !== initialCheckInDateRef.current
      const startTimeChanged =
        checkInTime.trim() !== '' && checkInTime !== initialCheckInTimeRef.current
      const endDateChanged = effectiveCheckOutDate !== initialCheckOutDateRef.current
      const endTimeChanged =
        checkOutTime.trim() !== '' && checkOutTime !== initialCheckOutTimeRef.current

      stayDatePatch = {
        ...(startDateChanged || startTimeChanged
          ? { start_at: newStartAt, ...(startTimeChanged ? { start_time_is_default: false } : {}) }
          : {}),
        ...(endDateChanged || endTimeChanged
          ? { end_at: newEndAt, ...(endTimeChanged ? { end_time_is_default: false } : {}) }
          : {}),
      }
    }

    // TABI-182: same idea as stayDatePatch above, but Activity's start/end can legitimately be
    // null both before and after editing (unlike Stay, which always has both from creation) —
    // so this compares directly against the current start_at/end_at rather than an initial-value
    // dirty-check, and requires start date+time together (an Activity is never date-only).
    let activityDatePatch: Partial<Reservation> = {}
    if (reservation.type === 'activity') {
      const trimmedStartDate = activityStartDate.trim()
      const trimmedStartTime = activityStartTime.trim()
      const hours = Number(durationHours) || 0
      const minutes = Number(durationMinutes) || 0
      const hasDuration = hours > 0 || minutes > 0

      let newStartAt: string | null = null
      if (trimmedStartDate && trimmedStartTime) {
        newStartAt = zonedTimeToUtc(trimmedStartDate, trimmedStartTime, reservation.start_timezone ?? localTimeZone())
      } else if (trimmedStartDate || trimmedStartTime) {
        setFormError(strings.addReservation.errorStartRequired)
        return
      }

      let newEndAt: string | null = null
      if (newStartAt && hasDuration) {
        const endTimeStr = addDurationToTime(trimmedStartTime, hours, minutes)
        newEndAt = zonedTimeToUtc(
          trimmedStartDate,
          endTimeStr,
          reservation.end_timezone ?? reservation.start_timezone ?? localTimeZone(),
        )
        if (newEndAt <= newStartAt) {
          setFormError(strings.reservationDetail.errorDurationCrossesMidnight)
          return
        }
      }

      activityDatePatch = {
        ...(newStartAt !== reservation.start_at ? { start_at: newStartAt } : {}),
        ...(newEndAt !== reservation.end_at ? { end_at: newEndAt } : {}),
      }
    }

    // TABI-211: Transport's departure/arrival, previously not editable at all here — same
    // initial-snapshot dirty-check shape as stayDatePatch above (both legs are always real, timed
    // events at creation, unlike Activity). An at_disposal leg has no time field to edit, so its
    // effective time always falls back to whatever was already stored.
    let transportDatePatch: Partial<Reservation> = {}
    if (reservation.type === 'transport' && reservation.start_at && reservation.end_at) {
      const effectiveStartDate = transportStartDate || initialTransportStartDateRef.current
      const effectiveEndDate = transportEndDate || initialTransportEndDateRef.current
      const effectiveStartTime = isTransportAtDisposal
        ? initialTransportStartTimeRef.current
        : transportStartTime.trim() || initialTransportStartTimeRef.current
      const effectiveEndTime = isTransportAtDisposal
        ? initialTransportEndTimeRef.current
        : transportEndTime.trim() || initialTransportEndTimeRef.current

      const newStartAt = zonedTimeToUtc(effectiveStartDate, effectiveStartTime, reservation.start_timezone ?? localTimeZone())
      const newEndAt = zonedTimeToUtc(effectiveEndDate, effectiveEndTime, reservation.end_timezone ?? localTimeZone())
      if (newEndAt <= newStartAt) {
        setFormError(strings.addReservation.errorEndBeforeStart)
        return
      }

      const startDateChanged = effectiveStartDate !== initialTransportStartDateRef.current
      const startTimeChanged =
        !isTransportAtDisposal &&
        transportStartTime.trim() !== '' &&
        transportStartTime !== initialTransportStartTimeRef.current
      const endDateChanged = effectiveEndDate !== initialTransportEndDateRef.current
      const endTimeChanged =
        !isTransportAtDisposal && transportEndTime.trim() !== '' && transportEndTime !== initialTransportEndTimeRef.current

      transportDatePatch = {
        ...(startDateChanged || startTimeChanged
          ? { start_at: newStartAt, ...(startTimeChanged ? { start_time_is_default: false } : {}) }
          : {}),
        ...(endDateChanged || endTimeChanged
          ? { end_at: newEndAt, ...(endTimeChanged ? { end_time_is_default: false } : {}) }
          : {}),
      }
    }

    let patch: Partial<Reservation> = {
      ...(isAutoNamedTransport ? {} : { name: name.trim() }),
      note: note.trim() || null,
      confirmation_number: confirmationNumber.trim() || null,
      price_amount: priceAmount.trim() === '' ? null : Number(priceAmount),
      // A price first entered here (created without one) would otherwise land with a null
      // currency, which the Budget total (TABI-55) can't attribute to the trip's currency.
      price_currency:
        priceAmount.trim() === '' ? null : (reservation.price_currency ?? trip?.currency ?? null),
      ...(reservation.type === 'stay'
        ? {
            stay_parking_included: parkingIncluded,
            stay_check_in_deadline: checkInDeadline || null,
          }
        : {}),
      ...stayDatePatch,
      ...activityDatePatch,
      ...transportDatePatch,
    }

    try {
      setGeocoding(true)
      const startPatch = await geocodeIfChanged('start', startAddress, reservation.start_address, requestPick, startPlace)
      const endPatch =
        reservation.type === 'transport'
          ? await geocodeIfChanged('end', endAddress, reservation.end_address, requestPick, endPlace)
          : {}
      patch = { ...patch, ...startPatch, ...endPatch }

      if (isAutoNamedTransport) {
        patch.name = transportRouteName(
          'start_place_name' in startPatch ? (startPatch.start_place_name ?? null) : reservation.start_place_name,
          'start_address' in startPatch ? (startPatch.start_address ?? null) : reservation.start_address,
          'end_place_name' in endPatch ? (endPatch.end_place_name ?? null) : reservation.end_place_name,
          'end_address' in endPatch ? (endPatch.end_address ?? null) : reservation.end_address,
        )
      }
    } catch (err) {
      if (err instanceof AddressSelectionCancelledError) {
        setFormError(strings.addressPicker.selectionRequiredError)
      } else if (err instanceof AddressNotFoundError) {
        setFormError(strings.reservationDetail.geocodeErrorNotFound)
      } else {
        logClientError('ReservationDetailScreen.geocode', err)
        setFormError(strings.reservationDetail.geocodeErrorGeneric)
      }
      setGeocoding(false)
      return
    }
    setGeocoding(false)

    // Bug fix: parity with AddReservationModal's TABI-113 out-of-period check, which the
    // create flow already enforces — only Stay/Transport have a full start/end pair whose
    // edit (checkout date, transport leg dates — the same fields TABI-210 wired a `min` to)
    // can land outside the trip's current dates; never blocking, just an explicit confirm.
    if ((reservation.type === 'stay' || reservation.type === 'transport') && trip?.start_date && trip?.end_date) {
      const datePatch = reservation.type === 'stay' ? stayDatePatch : transportDatePatch
      const candidate: DatedCandidate = {
        start_at: 'start_at' in datePatch ? (datePatch.start_at ?? null) : reservation.start_at,
        end_at: 'end_at' in datePatch ? (datePatch.end_at ?? null) : reservation.end_at,
        start_timezone: reservation.start_timezone,
        end_timezone: reservation.end_timezone,
      }
      const field = outOfPeriodField(candidate, trip)
      if (field) {
        setOutOfPeriodConfirm({ patch, field, candidate })
        return
      }
    }

    await commitSave(patch)
  }

  async function commitSave(patch: Partial<Reservation>) {
    setSaving(true)
    try {
      await onUpdate(patch)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('ReservationDetailScreen.handleSave', err)
      setFormError(strings.reservationDetail.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  async function handleExtendTrip() {
    if (!outOfPeriodConfirm || !trip?.start_date || !trip?.end_date) return
    const { patch, candidate } = outOfPeriodConfirm
    const range = extendedTripRange(candidate, { start_date: trip.start_date, end_date: trip.end_date })
    setSaving(true)
    setFormError(null)
    try {
      await updateTripDates(range.start_date, range.end_date)
    } catch (err) {
      logClientError('ReservationDetailScreen.handleExtendTrip', err)
      setFormError(strings.reservationDetail.errorGeneric)
      setSaving(false)
      return
    }
    setOutOfPeriodConfirm(null)
    await commitSave(patch)
  }

  // Same "Go back" behavior as AddReservationModal (Bugs DB, 25/08 fix) — pure cancel,
  // discards the edit and refocuses the field the user most likely needs to fix.
  function handleGoBackFromOutOfPeriod() {
    if (!outOfPeriodConfirm) return
    const { field } = outOfPeriodConfirm
    setOutOfPeriodConfirm(null)
    const targetId =
      reservation.type === 'stay'
        ? field === 'end' && manualEndDate
          ? STAY_CHECKOUT_DATE_FIELD_ID
          : STAY_CHECKIN_DATE_FIELD_ID
        : field === 'end'
          ? TRANSPORT_END_DATE_FIELD_ID
          : TRANSPORT_START_DATE_FIELD_ID
    // Wait a tick for the dialog to unmount before moving focus.
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus()
    })
  }

  async function handleDelete() {
    if (!window.confirm(strings.reservationDetail.deleteConfirm)) return
    setDeleting(true)
    try {
      await onDelete()
    } catch (err) {
      logClientError('ReservationDetailScreen.handleDelete', err)
      setFormError(strings.reservationDetail.errorGeneric)
      setDeleting(false)
    }
  }

  return (
    <APIProvider apiKey={mapsApiKey ?? ''}>
      <ScreenShell onBack={onBack}>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                <ReservationIcon reservation={reservation} className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-600">
                  {strings.reservationType[reservation.type]}
                </p>
                <h1 className="text-lg font-semibold text-slate-900">{reservation.name}</h1>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" onClick={handleDelete} disabled={deleting}>
                {strings.reservationDetail.delete}
              </Button>
            </div>
          </div>

          <MiniMap points={points} />

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {strings.reservationDetail.statusLabel}
            </p>
            <StatusPicker value={reservation.status} onChange={handleStatusChange} />
          </div>

          <TypeSpecificZone reservation={reservation} />

          <form
            onSubmit={handleSave}
            noValidate
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            {isAutoNamedTransport ? (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-700">{strings.reservationDetail.nameLabel}</p>
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {transportRouteName(
                    previewLegPlaceName(startPlace, startAddress, reservation.start_address, reservation.start_place_name),
                    startAddress.trim() || null,
                    previewLegPlaceName(endPlace, endAddress, reservation.end_address, reservation.end_place_name),
                    endAddress.trim() || null,
                  )}
                </p>
              </div>
            ) : (
              <Field label={strings.reservationDetail.nameLabel}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </Field>
            )}
            {reservation.type === 'stay' && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <p className="mb-1 text-sm font-medium text-slate-700">
                    {strings.reservationDetail.parkingLabel}
                  </p>
                  <ParkingPicker value={parkingIncluded} onChange={setParkingIncluded} />
                </div>
                <Field label={strings.reservationDetail.checkInDeadlineLabel} className="w-32">
                  <input
                    type="time"
                    value={checkInDeadline}
                    onChange={(e) => setCheckInDeadline(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </Field>
              </div>
            )}
            {reservation.type === 'stay' && (
              <div className="flex gap-3">
                <Field label={strings.reservationDetail.checkInDateLabel} className="flex-1">
                  <input
                    id={STAY_CHECKIN_DATE_FIELD_ID}
                    type="date"
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </Field>
                <Field label={strings.reservationDetail.checkInTimeLabel} className="flex-1">
                  <input
                    type="time"
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </Field>
              </div>
            )}
            {reservation.type === 'stay' &&
              (manualEndDate ? (
                <div className="space-y-2">
                  <div className="flex gap-3">
                    <Field label={strings.reservationDetail.checkOutDateLabel} className="flex-1">
                      <input
                        id={STAY_CHECKOUT_DATE_FIELD_ID}
                        type="date"
                        value={checkOutDate}
                        onChange={(e) => setCheckOutDate(e.target.value)}
                        min={checkInDate || undefined}
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                      />
                    </Field>
                    <Field label={strings.reservationDetail.checkOutTimeLabel} className="flex-1">
                      <input
                        type="time"
                        value={checkOutTime}
                        onChange={(e) => setCheckOutTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualEndDate(false)}
                    className="text-sm text-teal-700 underline"
                  >
                    {strings.addReservation.nightsCheckoutToggle}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-3">
                    <Field label={strings.addReservation.nightsLabel} className="w-20">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={nights}
                        onChange={(e) => setNights(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                      />
                    </Field>
                    <Field label={strings.reservationDetail.checkOutDateLabel} className="flex-1">
                      <input
                        type="date"
                        value={checkOutDate}
                        disabled
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-500"
                      />
                    </Field>
                    <Field label={strings.reservationDetail.checkOutTimeLabel} className="flex-1">
                      <input
                        type="time"
                        value={checkOutTime}
                        onChange={(e) => setCheckOutTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualEndDate(true)}
                    className="text-sm text-teal-700 underline"
                  >
                    {strings.addReservation.manualCheckoutToggle}
                  </button>
                </div>
              ))}
            {reservation.type === 'activity' && (
              <div className="flex gap-3">
                <Field label={strings.reservationDetail.startDateLabel} className="flex-1">
                  <input
                    type="date"
                    value={activityStartDate}
                    onChange={(e) => setActivityStartDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </Field>
                <Field label={strings.reservationDetail.startTimeLabel} className="flex-1">
                  <input
                    type="time"
                    value={activityStartTime}
                    onChange={(e) => setActivityStartTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </Field>
              </div>
            )}
            {reservation.type === 'activity' && (
              <DurationField
                legend={strings.addReservation.durationLabel}
                hours={durationHours}
                minutes={durationMinutes}
                onHoursChange={setDurationHours}
                onMinutesChange={setDurationMinutes}
              />
            )}
            {reservation.type === 'transport' && (
              <div className="flex gap-3">
                <Field
                  label={strings.reservationDetail.legDateLabel(transportLegLabels.start)}
                  className="flex-1"
                >
                  <input
                    id={TRANSPORT_START_DATE_FIELD_ID}
                    type="date"
                    value={transportStartDate}
                    onChange={(e) => setTransportStartDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </Field>
                {!isTransportAtDisposal && (
                  <Field
                    label={strings.reservationDetail.legTimeLabel(transportLegLabels.start)}
                    className="flex-1"
                  >
                    <input
                      type="time"
                      value={transportStartTime}
                      onChange={(e) => setTransportStartTime(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </Field>
                )}
              </div>
            )}
            {reservation.type === 'transport' && (
              <div className="flex gap-3">
                <Field
                  label={strings.reservationDetail.legDateLabel(transportLegLabels.end)}
                  className="flex-1"
                >
                  <input
                    id={TRANSPORT_END_DATE_FIELD_ID}
                    type="date"
                    value={transportEndDate}
                    onChange={(e) => setTransportEndDate(e.target.value)}
                    min={transportStartDate || undefined}
                    className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </Field>
                {!isTransportAtDisposal && (
                  <Field
                    label={strings.reservationDetail.legTimeLabel(transportLegLabels.end)}
                    className="flex-1"
                  >
                    <input
                      type="time"
                      value={transportEndTime}
                      onChange={(e) => setTransportEndTime(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </Field>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <Field label={strings.reservationDetail.priceLabel} className="flex-1">
                <input
                  type="number"
                  step="0.01"
                  value={priceAmount}
                  onChange={(e) => setPriceAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </Field>
              <Field label={strings.reservationDetail.currencyLabel} className="w-24">
                <input
                  value={reservation.price_currency ?? trip?.currency ?? ''}
                  disabled
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm uppercase text-slate-500"
                />
              </Field>
            </div>
            <Field label={strings.reservationDetail.confirmationNumberLabel}>
              <input
                type="text"
                value={confirmationNumber}
                onChange={(e) => setConfirmationNumber(e.target.value)}
                placeholder={strings.reservationDetail.confirmationNumberPlaceholder}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </Field>
            <Field label={strings.reservationDetail.notesLabel}>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={strings.reservationDetail.notesPlaceholder}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </Field>
            <PlaceAutocompleteField
              id="reservation-start-address"
              label={
                reservation.transport_subtype === 'at_disposal'
                  ? strings.reservationDetail.startAddressLabelAtDisposal
                  : strings.reservationDetail.startAddressLabel
              }
              value={startAddress}
              onTextChange={handleStartAddressChange}
              onPlaceSelect={handleStartPlaceSelect}
              citiesOnly={reservation.transport_subtype === 'at_disposal'}
            />
            {reservation.type === 'transport' && (
              <PlaceAutocompleteField
                id="reservation-end-address"
                label={
                  reservation.transport_subtype === 'at_disposal'
                    ? strings.reservationDetail.endAddressLabelAtDisposal
                    : strings.reservationDetail.endAddressLabel
                }
                value={endAddress}
                onTextChange={handleEndAddressChange}
                onPlaceSelect={handleEndPlaceSelect}
                citiesOnly={reservation.transport_subtype === 'at_disposal'}
              />
            )}
            {geocoding && <p className="text-sm text-slate-500">{strings.reservationDetail.geocoding}</p>}
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="submit" disabled={saving || geocoding || (!isAutoNamedTransport && !name.trim())}>
                {strings.reservationDetail.save}
              </Button>
            </div>
          </form>
        </div>
        {candidates && (
          <AddressCandidatePicker candidates={candidates} onSelect={selectCandidate} onCancel={cancelPick} />
        )}
        {outOfPeriodConfirm && (
          <ConfirmDialog
            title={strings.addReservation.outOfPeriodConfirmTitle}
            message={strings.addReservation.outOfPeriodConfirmMessage}
            confirmLabel={strings.addReservation.outOfPeriodExtendCta}
            onConfirm={handleExtendTrip}
            cancelLabel={strings.addReservation.outOfPeriodCancelCta}
            onCancel={handleGoBackFromOutOfPeriod}
            confirming={saving}
          />
        )}
      </ScreenShell>
    </APIProvider>
  )
}

async function geocodeIfChanged(
  leg: 'start' | 'end',
  newAddress: string,
  previousAddress: string | null,
  requestPick: (candidates: GeocodeCandidate[]) => Promise<GeocodeCandidate | null>,
  cached: ResolvedPlace | null,
): Promise<Partial<Reservation>> {
  const trimmed = newAddress.trim()
  if (trimmed === (previousAddress ?? '')) return {}

  if (!trimmed) {
    return leg === 'start'
      ? {
          start_address: null,
          start_lat: null,
          start_lng: null,
          start_timezone: null,
          start_place_name: null,
          start_city: null,
        }
      : { end_address: null, end_lat: null, end_lng: null, end_timezone: null, end_place_name: null, end_city: null }
  }

  const geocoded = cached ?? (await resolveAddress(trimmed, requestPick))
  if (!geocoded) return {}
  return leg === 'start'
    ? {
        start_address: geocoded.formattedAddress,
        start_lat: geocoded.lat,
        start_lng: geocoded.lng,
        start_timezone: geocoded.timezone,
        start_place_name: cached?.placeName ?? null,
        start_city: geocoded.city,
      }
    : {
        end_address: geocoded.formattedAddress,
        end_lat: geocoded.lat,
        end_lng: geocoded.lng,
        end_timezone: geocoded.timezone,
        end_place_name: cached?.placeName ?? null,
        end_city: geocoded.city,
      }
}

function TypeSpecificZone({ reservation }: { reservation: Reservation }) {
  const legLabels =
    reservation.transport_subtype === 'at_disposal'
      ? strings.reservationLegLabelsAtDisposal
      : strings.reservationLegLabels[reservation.type]

  if (reservation.type === 'transport') {
    // TABI-85: no read-only summary here — the date/time and address fields below are
    // directly editable, so a static Departure/Arrival block would just duplicate them.
    return null
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <LegRow
        label={legLabels.start}
        placeName={reservation.start_place_name}
        address={reservation.start_address}
        at={reservation.start_at}
        timezone={reservation.start_timezone}
        isTimeDefault={reservation.start_time_is_default}
      />
      {reservation.end_at && (
        <LegRow
          label={legLabels.end}
          placeName={reservation.end_place_name}
          address={reservation.end_address}
          at={reservation.end_at}
          timezone={reservation.end_timezone}
          isTimeDefault={reservation.end_time_is_default}
        />
      )}
      {reservation.type === 'stay' && (
        <StayFlags
          parkingIncluded={reservation.stay_parking_included}
          checkInDeadline={reservation.stay_check_in_deadline}
        />
      )}
      {/* TABI-14: place_* columns are written unconditionally regardless of reservation
          type (see AddReservationModal's submit payload), so this isn't gated to
          type === 'activity' — ActivityPlaceFlags' own null-guard handles "nothing to show". */}
      <ActivityPlaceFlags
        rating={reservation.place_rating}
        userRatingsTotal={reservation.place_user_ratings_total}
        photoRef={reservation.place_photo_ref}
        category={reservation.place_category}
      />
    </div>
  )
}

// TABI-49: read-only — this is a Google snapshot taken at bookmark time via the rich
// Places search (ActivityPlaceSearchModal), never a user-editable field, so unlike the
// rest of this inline-editable screen there's no edit path for these values.
function ActivityPlaceFlags({
  rating,
  userRatingsTotal,
  photoRef,
  category,
}: {
  rating: number | null
  userRatingsTotal: number | null
  photoRef: string | null
  category: string | null
}) {
  if (rating === null && !photoRef && !category) return null
  return (
    <div className="flex items-center gap-3 pt-1">
      {photoRef && (
        <img src={placePhotoUrl(photoRef, 100)} alt="" className="h-12 w-12 flex-shrink-0 rounded-md object-cover" />
      )}
      <div className="flex flex-wrap gap-2">
        {rating !== null && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {strings.activityPlaceSearch.ratingLabel(rating, userRatingsTotal ?? 0)}
          </span>
        )}
        {category && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {category}
          </span>
        )}
      </div>
    </div>
  )
}

function StayFlags({
  parkingIncluded,
  checkInDeadline,
}: {
  parkingIncluded: boolean | null
  checkInDeadline: string | null
}) {
  if (parkingIncluded === null && !checkInDeadline) return null
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {checkInDeadline && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          {strings.stayMenu.checkInDeadlineFlag(checkInDeadline.slice(0, 5))}
        </span>
      )}
      {parkingIncluded === false && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          {strings.stayMenu.noParkingFlag}
        </span>
      )}
      {parkingIncluded === true && (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          {strings.stayMenu.parkingIncludedFlag}
        </span>
      )}
    </div>
  )
}

function LegRow({
  label,
  placeName,
  address,
  at,
  timezone,
  isTimeDefault,
}: {
  label: string
  placeName: string | null
  address: string | null
  at: string | null
  timezone: string | null
  isTimeDefault?: boolean
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-900">{placeName ?? address ?? '—'}</p>
      {address && placeName && <p className="text-xs text-slate-500">{address}</p>}
      {at && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>{formatInZone(at, timezone)}</span>
          {isTimeDefault && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {strings.reservationDetail.defaultTimeBadge}
            </span>
          )}
        </p>
      )}
    </div>
  )
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

// TABI-182: mirrors AddReservationModal's DurationField (TABI-181) — duplicated per this
// codebase's existing convention of file-local small form pieces (see Field, DateTimeField).
function DurationField({
  legend,
  hours,
  minutes,
  onHoursChange,
  onMinutesChange,
}: {
  legend: string
  hours: string
  minutes: string
  onHoursChange: (value: string) => void
  onMinutesChange: (value: string) => void
}) {
  return (
    <fieldset className="flex-1">
      <legend className="mb-1 block text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          max={23}
          step={1}
          aria-label={strings.addReservation.durationHoursLabel}
          placeholder={strings.addReservation.durationHoursLabel}
          value={hours}
          onChange={(event) => onHoursChange(event.target.value)}
          className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
        <input
          type="number"
          min={0}
          max={59}
          step={1}
          aria-label={strings.addReservation.durationMinutesLabel}
          placeholder={strings.addReservation.durationMinutesLabel}
          value={minutes}
          onChange={(event) => onMinutesChange(event.target.value)}
          className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
    </fieldset>
  )
}

function ParkingPicker({
  value,
  onChange,
}: {
  value: boolean | null
  onChange: (included: boolean) => void
}) {
  return (
    <div role="radiogroup" className="flex gap-2">
      {(
        [
          [true, strings.reservationDetail.parkingYes],
          [false, strings.reservationDetail.parkingNo],
        ] as const
      ).map(([option, label]) => {
        const selected = value === option
        return (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              selected
                ? 'border-teal-600 bg-teal-50 text-teal-700'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
