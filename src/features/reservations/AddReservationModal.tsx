import { APIProvider } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FormSheet } from '../../components/ui/FormSheet'
import type { PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { PlaceAutocompleteField } from '../../components/ui/PlaceAutocompleteField'
import { StatusPicker } from '../../components/ui/StatusPicker'
import { formatDayPillLabel, localDateKey, localTimeKey, localTimeZone, zonedTimeToUtc } from '../../lib/datetime'
import {
  AddressSelectionCancelledError,
  fetchGeocodeByPlaceId,
  resolveAddress,
  type GeocodeResult,
} from '../../lib/geocode'
import { strings } from '../../lib/strings'
import type {
  NewReservation,
  Reservation,
  ReservationStatus,
  ReservationType,
  StaySubtype,
  TransportSubtype,
} from '../../types/reservation'
import { addDays, computeAccommodationGaps } from '../stay/computeAccommodationGaps'
import { useTrip } from '../trips/useTrip'
import { useTripDayLocations } from '../trips/useTripDayLocations'
import { findLocationMismatch, type LocationMismatch } from './locationMismatch'
import { findOverlappingReservation } from './reservationOverlap'
import { transportRouteName } from './transportRouteName'
import { extendedTripRange, isOutsideTripPeriod } from './tripPeriod'
import { useAddressPicker } from './useAddressPicker'
import { useReservationsByType } from './useReservationsByType'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export type ResolvedPlace = GeocodeResult & { placeName: string | null }

// TABI-144: check-in/check-out time is optional for Stay — a standard default
// (15:00/11:00) is applied when left blank, per TABI-16's original spec.
const STAY_DEFAULT_CHECK_IN_TIME = '15:00'
const STAY_DEFAULT_CHECK_OUT_TIME = '11:00'

const mainTypeOptions: ReservationType[] = ['stay', 'transport', 'activity']
const staySubtypeOptions: StaySubtype[] = ['hotel', 'camping', 'airbnb', 'ryokan', 'other']
const transportSubtypeOptions: TransportSubtype[] = ['point_to_point', 'at_disposal']

interface AddReservationModalProps {
  tripId: string
  defaultType?: ReservationType
  defaultTransportSubtype?: TransportSubtype
  /**
   * Seeds the start date/time from a free-time block on the timeline (TABI-54)
   * — the block's own real-location timezone, not the browser's, since
   * `initialTimezone` also stands in for `startTimezone` below until a real
   * address is geocoded.
   */
  initialStartAt?: string | null
  initialTimezone?: string | null
  /**
   * TABI-155: seeds the end date/time and both addresses when creating a
   * Transport reservation directly from a computed "Getting Around" leg —
   * the departure/arrival points and an estimated arrival are already known,
   * so there's no need to re-geocode what the travel-time engine just resolved.
   */
  initialEndAt?: string | null
  initialEndTimezone?: string | null
  initialStartPlace?: ResolvedPlace | null
  initialEndPlace?: ResolvedPlace | null
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

export function AddReservationModal({
  tripId,
  defaultType = 'stay',
  defaultTransportSubtype = 'point_to_point',
  initialStartAt = null,
  initialTimezone = null,
  initialEndAt = null,
  initialEndTimezone = null,
  initialStartPlace = null,
  initialEndPlace = null,
  onClose,
  onCreate,
}: AddReservationModalProps) {
  const [mainType, setMainType] = useState<ReservationType>(defaultType)
  // TABI-126: the add sheet inherits its type from the menu it was opened from (Stay/Transport/
  // Activities) instead of re-asking — the selector stays collapsed until "Change type" is used.
  const [typeExpanded, setTypeExpanded] = useState(false)
  const [staySubtype, setStaySubtype] = useState<StaySubtype>('hotel')
  // TABI-121: Transport's own sub-type (point-to-point vs vehicle rental), symmetric to Stay's —
  // shown whenever the main type is Transport, not folded into the main type selector.
  const [transportSubtype, setTransportSubtype] = useState<TransportSubtype>(defaultTransportSubtype)
  const [parkingIncluded, setParkingIncluded] = useState<boolean | null>(null)
  const [checkInDeadline, setCheckInDeadline] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<ReservationStatus>('to_book')
  const [startAddress, setStartAddress] = useState(() => initialStartPlace?.formattedAddress ?? '')
  const [endAddress, setEndAddress] = useState(() => initialEndPlace?.formattedAddress ?? '')
  const [startPlace, setStartPlace] = useState<ResolvedPlace | null>(() => initialStartPlace)
  const [endPlace, setEndPlace] = useState<ResolvedPlace | null>(() => initialEndPlace)
  const [startDate, setStartDate] = useState(() =>
    initialStartAt ? localDateKey(initialStartAt, initialTimezone) : '',
  )
  const [startTime, setStartTime] = useState(() =>
    initialStartAt ? localTimeKey(initialStartAt, initialTimezone) : '',
  )
  const [endDate, setEndDate] = useState(() =>
    initialEndAt ? localDateKey(initialEndAt, initialEndTimezone ?? initialTimezone) : '',
  )
  const [endTime, setEndTime] = useState(() =>
    initialEndAt ? localTimeKey(initialEndAt, initialEndTimezone ?? initialTimezone) : '',
  )
  const [nights, setNights] = useState('')
  const [manualEndDate, setManualEndDate] = useState(false)
  const [priceAmount, setPriceAmount] = useState('')
  const [priceCurrency, setPriceCurrency] = useState('')
  const [note, setNote] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlapConfirm, setOverlapConfirm] = useState<{
    reservation: Reservation
    input: Omit<NewReservation, 'trip_id'>
  } | null>(null)
  const [overlapNote, setOverlapNote] = useState('')
  const [outOfPeriodConfirm, setOutOfPeriodConfirm] = useState<{
    input: Omit<NewReservation, 'trip_id'>
  } | null>(null)
  const [locationMismatchConfirm, setLocationMismatchConfirm] = useState<{
    input: Omit<NewReservation, 'trip_id'>
    mismatch: LocationMismatch
  } | null>(null)
  const { candidates, requestPick, selectCandidate, cancelPick } = useAddressPicker()

  // Field requirements derive from the main type + (for Transport) its subtype, rather than
  // a flat list of pre-baked combinations — see TABI-121.
  const isTransport = mainType === 'transport'
  const isPointToPoint = isTransport && transportSubtype === 'point_to_point'
  const isAtDisposal = isTransport && transportSubtype === 'at_disposal'
  const option = {
    dbType: mainType,
    transportSubtype: isTransport ? transportSubtype : null,
    requiresEndAddress: isPointToPoint || isAtDisposal,
    requiresStart: mainType !== 'activity',
    requiresStartTime: isPointToPoint,
    requiresEnd: mainType !== 'activity',
    requiresEndTime: isPointToPoint,
  }
  // TABI-122: point-to-point transport has no free-text name — it's derived from the route.
  const isAutoNamedTransport = isPointToPoint
  // Overlap detection (TABI-108) only applies within Stay or within Transport — fetch
  // whichever type is currently selected so switching type mid-form checks against the right set.
  const { reservations: sameTypeReservations, loading: sameTypeLoading } = useReservationsByType(
    tripId,
    option.dbType,
  )
  const { trip, loading: tripLoading, updateDates: updateTripDates } = useTrip(tripId)
  const { locationsByDate: dayLocationsByDate } = useTripDayLocations(tripId)

  // TABI-111: prefill the start date with the trip's first night not yet covered by a Stay
  // reservation (reusing the accommodation coverage-gap logic) — or the trip's own start date
  // if no stay is booked yet. Runs once the relevant data has loaded, and only while the field
  // is still untouched, so it never overwrites what the user typed.
  const hasPrefilledStartDateRef = useRef(false)
  useEffect(() => {
    if (hasPrefilledStartDateRef.current) return
    if (option.dbType !== 'stay') return
    if (tripLoading || sameTypeLoading) return
    if (startDate !== '') return

    const gaps = computeAccommodationGaps(trip ?? { start_date: null, end_date: null }, sameTypeReservations)
    const firstUncoveredStart =
      gaps.length > 0 ? gaps[0].start : sameTypeReservations.length === 0 ? (trip?.start_date ?? null) : null

    if (firstUncoveredStart) {
      setStartDate(firstUncoveredStart)
      hasPrefilledStartDateRef.current = true
    }
  }, [option.dbType, trip, tripLoading, sameTypeReservations, sameTypeLoading, startDate])

  // TABI-112: for Stay, derive the checkout date from check-in + nights instead of asking the
  // user to pick it directly. Only while manualEndDate is off — flipping it hands endDate back
  // to direct editing via DateTimeField.
  useEffect(() => {
    if (option.dbType !== 'stay' || manualEndDate) return
    const n = Number(nights)
    if (!startDate || nights.trim() === '' || !Number.isFinite(n) || n < 1) {
      setEndDate('')
      return
    }
    setEndDate(addDays(startDate, Math.trunc(n)))
  }, [option.dbType, manualEndDate, startDate, nights])

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
      // Fall back silently — handleSubmit's free-text resolveAddress() covers this.
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
      // Fall back silently — handleSubmit's free-text resolveAddress() covers this.
    } finally {
      setGeocoding(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!isAutoNamedTransport && !name.trim()) {
      setError(strings.addReservation.errorNameRequired)
      return
    }
    if (option.requiresStart && (!startDate || (option.requiresStartTime && !startTime))) {
      setError(strings.addReservation.errorStartRequired)
      return
    }
    if (option.requiresEnd) {
      if (option.dbType === 'stay' && !manualEndDate) {
        if (!nights.trim() || Number(nights) < 1) {
          setError(strings.addReservation.errorNightsRequired)
          return
        }
      } else if (!endDate || (option.requiresEndTime && !endTime)) {
        setError(strings.addReservation.errorEndRequired)
        return
      }
    }

    setGeocoding(true)
    let startGeo: ResolvedPlace | null = startPlace
    let endGeo: ResolvedPlace | null = endPlace
    try {
      if (!startGeo) {
        const resolved = await resolveAddress(startAddress, requestPick)
        startGeo = resolved ? { ...resolved, placeName: null } : null
      }
      if (option.requiresEndAddress && !endGeo) {
        const resolved = await resolveAddress(endAddress, requestPick)
        endGeo = resolved ? { ...resolved, placeName: null } : null
      }
    } catch (err) {
      setError(
        err instanceof AddressSelectionCancelledError
          ? strings.addressPicker.selectionRequiredError
          : strings.addReservation.geocodeErrorGeneric,
      )
      setGeocoding(false)
      return
    }
    setGeocoding(false)

    const startTimezone = startGeo?.timezone ?? initialTimezone ?? localTimeZone()
    const endTimezone = option.requiresEndAddress ? (endGeo?.timezone ?? startTimezone) : startTimezone

    // Vehicle rental collects a date range, not exact times (TABI-123) — anchor to midday so
    // the stored timestamp never drifts to an adjacent calendar day across timezone conversion.
    // TABI-144: Stay check-in/check-out time is optional — fall back to a standard default
    // (15:00/11:00) when left blank, flagged so the detail screen can surface it as unconfirmed.
    const startTimeDefaulted = option.dbType === 'stay' && !startTime
    const endTimeDefaulted = option.dbType === 'stay' && !endTime
    const effectiveStartTime = isAtDisposal ? '12:00' : startTimeDefaulted ? STAY_DEFAULT_CHECK_IN_TIME : startTime
    const effectiveEndTime = isAtDisposal ? '12:00' : endTimeDefaulted ? STAY_DEFAULT_CHECK_OUT_TIME : endTime
    const startAt = startDate && effectiveStartTime ? zonedTimeToUtc(startDate, effectiveStartTime, startTimezone) : null
    const endAt = endDate && effectiveEndTime ? zonedTimeToUtc(endDate, effectiveEndTime, endTimezone) : null

    if (startAt && endAt && endAt < startAt) {
      setError(strings.addReservation.errorEndBeforeStart)
      return
    }

    const resolvedName = isAutoNamedTransport
      ? transportRouteName(
          startGeo?.placeName ?? null,
          startGeo?.formattedAddress ?? (startAddress.trim() || null),
          endGeo?.placeName ?? null,
          endGeo?.formattedAddress ?? (endAddress.trim() || null),
        )
      : name.trim()

    const input: Omit<NewReservation, 'trip_id'> = {
      type: option.dbType,
      transport_subtype: option.transportSubtype,
      stay_subtype: option.dbType === 'stay' ? staySubtype : null,
      stay_parking_included: option.dbType === 'stay' ? parkingIncluded : null,
      stay_check_in_deadline: option.dbType === 'stay' && checkInDeadline ? checkInDeadline : null,
      name: resolvedName,
      status,
      note: note.trim() || null,
      price_amount: priceAmount.trim() === '' ? null : Number(priceAmount),
      price_currency: priceCurrency.trim() || null,
      start_at: startAt,
      end_at: endAt,
      start_time_is_default: startTimeDefaulted,
      end_time_is_default: endTimeDefaulted,
      start_address: startGeo?.formattedAddress ?? (startAddress.trim() || null),
      start_lat: startGeo?.lat ?? null,
      start_lng: startGeo?.lng ?? null,
      start_place_name: startGeo?.placeName ?? null,
      start_timezone: startAt ? startTimezone : null,
      start_city: startGeo?.city ?? null,
      end_address: option.requiresEndAddress ? (endGeo?.formattedAddress ?? (endAddress.trim() || null)) : null,
      end_lat: option.requiresEndAddress ? (endGeo?.lat ?? null) : null,
      end_lng: option.requiresEndAddress ? (endGeo?.lng ?? null) : null,
      end_place_name: option.requiresEndAddress ? (endGeo?.placeName ?? null) : null,
      end_timezone: endAt ? endTimezone : null,
      end_city: option.requiresEndAddress ? (endGeo?.city ?? null) : null,
    }

    if (startAt && endAt && option.dbType !== 'activity') {
      const overlapping = findOverlappingReservation({ start_at: startAt, end_at: endAt }, sameTypeReservations)
      if (overlapping) {
        setOverlapConfirm({ reservation: overlapping, input })
        return
      }
    }

    await proceedAfterOverlapCheck(input)
  }

  // TABI-113: checked once any overlap has been resolved (or there was none) — a reservation
  // outside the trip's current dates is never blocked either, just confirmed explicitly.
  async function proceedAfterOverlapCheck(input: Omit<NewReservation, 'trip_id'>) {
    if (trip && isOutsideTripPeriod(input, trip)) {
      setOutOfPeriodConfirm({ input })
      return
    }
    await proceedAfterOutOfPeriodCheck(input)
  }

  // TABI-116: checked last — once dates are settled, compare the reservation's city against
  // the planned location of each day it covers. A mismatch is never blocking either, just
  // surfaced so the traveler can confirm it's intentional.
  async function proceedAfterOutOfPeriodCheck(input: Omit<NewReservation, 'trip_id'>) {
    const mismatch = findLocationMismatch(input, dayLocationsByDate)
    if (mismatch) {
      setLocationMismatchConfirm({ input, mismatch })
      return
    }
    await submitReservation(input)
  }

  async function submitReservation(input: Omit<NewReservation, 'trip_id'>) {
    setSubmitting(true)
    setError(null)
    try {
      await onCreate(input)
      onClose()
    } catch {
      setError(strings.addReservation.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirmOverlap() {
    if (!overlapConfirm) return
    const trimmedOverlapNote = overlapNote.trim()
    const input = trimmedOverlapNote
      ? {
          ...overlapConfirm.input,
          note: overlapConfirm.input.note ? `${overlapConfirm.input.note}\n${trimmedOverlapNote}` : trimmedOverlapNote,
        }
      : overlapConfirm.input
    setOverlapConfirm(null)
    setOverlapNote('')
    await proceedAfterOverlapCheck(input)
  }

  function handleCancelOverlap() {
    setOverlapConfirm(null)
    setOverlapNote('')
  }

  async function handleExtendTrip() {
    if (!outOfPeriodConfirm || !trip?.start_date || !trip?.end_date) return
    const { input } = outOfPeriodConfirm
    const range = extendedTripRange(input, { start_date: trip.start_date, end_date: trip.end_date })
    setSubmitting(true)
    setError(null)
    try {
      await updateTripDates(range.start_date, range.end_date)
    } catch {
      setError(strings.addReservation.errorGeneric)
      setSubmitting(false)
      return
    }
    setOutOfPeriodConfirm(null)
    await proceedAfterOutOfPeriodCheck(input)
  }

  async function handleKeepDatesAsIs() {
    if (!outOfPeriodConfirm) return
    const { input } = outOfPeriodConfirm
    setOutOfPeriodConfirm(null)
    await proceedAfterOutOfPeriodCheck(input)
  }

  async function handleConfirmLocationMismatch() {
    if (!locationMismatchConfirm) return
    const { input } = locationMismatchConfirm
    setLocationMismatchConfirm(null)
    await submitReservation(input)
  }

  function handleCancelLocationMismatch() {
    setLocationMismatchConfirm(null)
  }

  return (
    <APIProvider apiKey={mapsApiKey ?? ''}>
      <FormSheet
        title={strings.addReservation.title}
        onSubmit={handleSubmit}
        onClose={onClose}
        cancelLabel={strings.addReservation.cancel}
        submitLabel={strings.addReservation.submit}
        submitting={submitting}
        submitDisabled={geocoding}
      >
        {typeExpanded ? (
          <Field label={strings.addReservation.typeLabel}>
            <select
              value={mainType}
              onChange={(event) => setMainType(event.target.value as ReservationType)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            >
              {mainTypeOptions.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {strings.reservationType[candidate]}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-900">{strings.reservationType[mainType]}</span>
            <button
              type="button"
              onClick={() => setTypeExpanded(true)}
              className="text-sm text-teal-700 underline"
            >
              {strings.addReservation.changeTypeToggle}
            </button>
          </div>
        )}

        {option.dbType === 'stay' && (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">
              {strings.addReservation.staySubtypeLabel}
            </p>
            <StaySubtypePicker value={staySubtype} onChange={setStaySubtype} />
          </div>
        )}

        {isTransport && (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">
              {strings.addReservation.transportSubtypeLabel}
            </p>
            <TransportSubtypePicker value={transportSubtype} onChange={setTransportSubtype} />
          </div>
        )}

        {option.dbType === 'stay' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="mb-1 text-sm font-medium text-slate-700">{strings.addReservation.parkingLabel}</p>
              <ParkingPicker value={parkingIncluded} onChange={setParkingIncluded} />
            </div>
            <Field label={strings.addReservation.checkInDeadlineLabel} className="w-32">
              <input
                type="time"
                value={checkInDeadline}
                onChange={(event) => setCheckInDeadline(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </Field>
          </div>
        )}

        {isAutoNamedTransport ? (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">{strings.addReservation.nameLabel}</p>
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {startAddress.trim() || endAddress.trim()
                ? transportRouteName(
                    startPlace?.placeName ?? null,
                    startAddress.trim() || null,
                    endPlace?.placeName ?? null,
                    endAddress.trim() || null,
                  )
                : strings.addReservation.nameAutoGeneratedPlaceholder}
            </p>
          </div>
        ) : (
          <Field label={strings.addReservation.nameLabel}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={strings.addReservation.namePlaceholder}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </Field>
        )}

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">{strings.addReservation.statusLabel}</p>
          <StatusPicker value={status} onChange={setStatus} />
        </div>

        <PlaceAutocompleteField
          id="start-address"
          label={
            isAtDisposal
              ? strings.addReservation.startAddressLabelAtDisposal
              : option.requiresEndAddress
                ? strings.addReservation.startAddressLabelTransport
                : strings.addReservation.startAddressLabel
          }
          value={startAddress}
          onTextChange={handleStartAddressChange}
          onPlaceSelect={handleStartPlaceSelect}
          citiesOnly={isAtDisposal}
        />

        {option.requiresEndAddress && (
          <PlaceAutocompleteField
            id="end-address"
            label={
              isAtDisposal
                ? strings.addReservation.endAddressLabelAtDisposal
                : strings.addReservation.endAddressLabel
            }
            value={endAddress}
            onTextChange={handleEndAddressChange}
            onPlaceSelect={handleEndPlaceSelect}
            citiesOnly={isAtDisposal}
          />
        )}

        {isAtDisposal ? (
          <DateField
            legend={strings.addReservation.startLabel}
            date={startDate}
            onDateChange={setStartDate}
            required={option.requiresStart}
          />
        ) : (
          <DateTimeField
            legend={strings.addReservation.startLabel}
            date={startDate}
            time={startTime}
            onDateChange={setStartDate}
            onTimeChange={setStartTime}
            dateRequired={option.requiresStart}
            timeRequired={option.requiresStartTime}
          />
        )}

        {option.dbType === 'stay' && !manualEndDate ? (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Field label={strings.addReservation.nightsLabel} className="w-20">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={nights}
                  onChange={(event) => setNights(event.target.value)}
                  required={option.requiresEnd}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </Field>
              <fieldset className="flex-1">
                <legend className="mb-1 block text-sm font-medium text-slate-700">
                  {strings.addReservation.endLabel}
                </legend>
                <div className="flex gap-2">
                  <input
                    type="date"
                    aria-label={`${strings.addReservation.endLabel} date`}
                    value={endDate}
                    disabled
                    className="w-1/2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-500"
                  />
                  <input
                    type="time"
                    aria-label={`${strings.addReservation.endLabel} time`}
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    required={option.requiresEndTime}
                    className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </fieldset>
            </div>
            <button
              type="button"
              onClick={() => setManualEndDate(true)}
              className="text-sm text-teal-700 underline"
            >
              {strings.addReservation.manualCheckoutToggle}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {isAtDisposal ? (
              <DateField
                legend={strings.addReservation.endLabel}
                date={endDate}
                onDateChange={setEndDate}
                required={option.requiresEnd}
              />
            ) : (
              <DateTimeField
                legend={strings.addReservation.endLabel}
                date={endDate}
                time={endTime}
                onDateChange={setEndDate}
                onTimeChange={setEndTime}
                dateRequired={option.requiresEnd}
                timeRequired={option.requiresEndTime}
              />
            )}
            {option.dbType === 'stay' && (
              <button
                type="button"
                onClick={() => setManualEndDate(false)}
                className="text-sm text-teal-700 underline"
              >
                {strings.addReservation.nightsCheckoutToggle}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Field label={strings.addReservation.priceLabel} className="flex-1">
            <input
              type="number"
              step="0.01"
              value={priceAmount}
              onChange={(event) => setPriceAmount(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </Field>
          <Field label={strings.addReservation.currencyLabel} className="w-24">
            <input
              value={priceCurrency}
              onChange={(event) => setPriceCurrency(event.target.value.toUpperCase())}
              maxLength={3}
              placeholder="USD"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-teal-600 focus:outline-none"
            />
          </Field>
        </div>

        <Field label={strings.addReservation.notesLabel}>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={strings.addReservation.notesPlaceholder}
            rows={3}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </Field>

        {geocoding && <p className="text-sm text-slate-500">{strings.addReservation.geocoding}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </FormSheet>
      {candidates && (
        <AddressCandidatePicker candidates={candidates} onSelect={selectCandidate} onCancel={cancelPick} />
      )}
      {overlapConfirm && (
        <ConfirmDialog
          title={strings.addReservation.overlapConfirmTitle}
          message={strings.addReservation.overlapConfirmMessage(overlapConfirm.reservation.name)}
          noteLabel={strings.addReservation.overlapNoteLabel}
          notePlaceholder={strings.addReservation.overlapNotePlaceholder}
          note={overlapNote}
          onNoteChange={setOverlapNote}
          confirmLabel={strings.addReservation.overlapConfirmCta}
          cancelLabel={strings.addReservation.overlapCancelCta}
          onConfirm={handleConfirmOverlap}
          onCancel={handleCancelOverlap}
          confirming={submitting}
        />
      )}
      {outOfPeriodConfirm && (
        <ConfirmDialog
          title={strings.addReservation.outOfPeriodConfirmTitle}
          message={strings.addReservation.outOfPeriodConfirmMessage}
          confirmLabel={strings.addReservation.outOfPeriodExtendCta}
          onConfirm={handleExtendTrip}
          secondaryLabel={strings.addReservation.outOfPeriodKeepCta}
          onSecondary={handleKeepDatesAsIs}
          confirming={submitting}
        />
      )}
      {locationMismatchConfirm && (
        <ConfirmDialog
          title={strings.addReservation.locationMismatchConfirmTitle}
          message={strings.addReservation.locationMismatchConfirmMessage(
            locationMismatchConfirm.mismatch.reservationCity,
            locationMismatchConfirm.mismatch.plannedCity,
            formatDayPillLabel(locationMismatchConfirm.mismatch.dayKey),
          )}
          confirmLabel={strings.addReservation.locationMismatchConfirmCta}
          onConfirm={handleConfirmLocationMismatch}
          cancelLabel={strings.addReservation.locationMismatchCancelCta}
          onCancel={handleCancelLocationMismatch}
          confirming={submitting}
        />
      )}
    </APIProvider>
  )
}

function StaySubtypePicker({
  value,
  onChange,
}: {
  value: StaySubtype
  onChange: (subtype: StaySubtype) => void
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {staySubtypeOptions.map((subtype) => {
        const selected = subtype === value
        return (
          <button
            key={subtype}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(subtype)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              selected
                ? 'border-teal-600 bg-teal-50 text-teal-700'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {strings.addReservation.staySubtypes[subtype]}
          </button>
        )
      })}
    </div>
  )
}

function TransportSubtypePicker({
  value,
  onChange,
}: {
  value: TransportSubtype
  onChange: (subtype: TransportSubtype) => void
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {transportSubtypeOptions.map((subtype) => {
        const selected = subtype === value
        return (
          <button
            key={subtype}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(subtype)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              selected
                ? 'border-teal-600 bg-teal-50 text-teal-700'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {strings.addReservation.transportSubtypes[subtype]}
          </button>
        )
      })}
    </div>
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
          [true, strings.addReservation.parkingYes],
          [false, strings.addReservation.parkingNo],
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

function DateField({
  legend,
  date,
  onDateChange,
  required,
}: {
  legend: string
  date: string
  onDateChange: (value: string) => void
  required: boolean
}) {
  return (
    <fieldset className="flex-1">
      <legend className="mb-1 block text-sm font-medium text-slate-700">{legend}</legend>
      <input
        type="date"
        aria-label={`${legend} date`}
        value={date}
        onChange={(event) => onDateChange(event.target.value)}
        required={required}
        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
      />
    </fieldset>
  )
}

function DateTimeField({
  legend,
  date,
  time,
  onDateChange,
  onTimeChange,
  dateRequired,
  timeRequired,
}: {
  legend: string
  date: string
  time: string
  onDateChange: (value: string) => void
  onTimeChange: (value: string) => void
  dateRequired: boolean
  timeRequired: boolean
}) {
  return (
    <fieldset className="flex-1">
      <legend className="mb-1 block text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex gap-2">
        <input
          type="date"
          aria-label={`${legend} date`}
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
          required={dateRequired}
          className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
        <input
          type="time"
          aria-label={`${legend} time`}
          value={time}
          onChange={(event) => onTimeChange(event.target.value)}
          required={timeRequired}
          className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
    </fieldset>
  )
}
