import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Field } from '../../components/ui/Field'
import { FormSheet } from '../../components/ui/FormSheet'
import type { PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { PlaceAutocompleteField } from '../../components/ui/PlaceAutocompleteField'
import { StatusPicker } from '../../components/ui/StatusPicker'
import {
  addDurationToTime,
  formatDayPillLabel,
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
  type GeocodeResult,
} from '../../lib/geocode'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
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
import { useTripReservations } from '../trips/useTripReservations'
import { lastKnownTripLocation } from './lastKnownTripLocation'
import { findLocationMismatch, type LocationMismatch } from './locationMismatch'
import { findOverlappingReservation } from './reservationOverlap'
import { transportRouteName } from './transportRouteName'
import { extendedTripRange, outOfPeriodField, type OutOfPeriodField } from './tripPeriod'
import { useAddressPicker } from './useAddressPicker'
import { useReservationsByType } from './useReservationsByType'

export type ResolvedPlace = GeocodeResult & {
  placeName: string | null
  /**
   * TABI-49: only set when this place came from the rich Google Places search
   * (ActivityPlaceSearchModal) — the plain PlaceAutocompleteField fallback never
   * populates this, so `place_*` columns stay null for that path, per the Decision
   * Log's "explicitly distinct from plain autocomplete" requirement.
   */
  placeDetails?: {
    googlePlaceId: string
    rating: number | null
    userRatingsTotal: number | null
    photoRef: string | null
    category: string | null
  } | null
}

// TABI-144: check-in/check-out time is optional for Stay — a standard default
// (14:00/10:00, per TABI-205) is applied when left blank.
const STAY_DEFAULT_CHECK_IN_TIME = '14:00'
const STAY_DEFAULT_CHECK_OUT_TIME = '10:00'

// A point-to-point Transport departure time is optional too — it used to hard-block submission
// ("Start date and time are required"), but a missing departure time is exactly the kind of gap
// that shouldn't dead-end the flow (e.g. TABI-208's bulk import rarely has a precise time). Falls
// back to the trip's own day-window opening time instead (`trip.day_start_time` — the same field
// TripLegsSection already anchors a leg quick-add to), flagged via start_time_is_default so it's
// never silent: this feeds the travel-time engine directly (5b), so the traveler needs to see it
// was guessed, via the same "Default" badge TABI-144 already renders on the detail screen for
// defaulted Stay times. Only used if `trip` hasn't loaded yet.
const DAY_START_TIME_FALLBACK = '08:00'

// Stable ids for the start/end date inputs, used to refocus whichever one triggered
// the "Outside trip dates" confirmation once the user chooses "Go back".
const START_DATE_FIELD_ID = 'reservation-date-start'
const END_DATE_FIELD_ID = 'reservation-date-end'

const mainTypeOptions: ReservationType[] = ['stay', 'transport', 'activity']
const staySubtypeOptions: StaySubtype[] = ['hotel', 'camping', 'airbnb', 'ryokan', 'other']
const transportSubtypeOptions: TransportSubtype[] = ['point_to_point', 'at_disposal']

interface AddReservationModalProps {
  tripId: string
  defaultType?: ReservationType
  defaultTransportSubtype?: TransportSubtype
  /**
   * TABI-54: a free-time block on the timeline has no origin menu to inherit a type
   * from (unlike Stay/Transport/Activities, where TABI-126's inherited-type collapse
   * is correct) — so the type selector starts expanded, forcing an explicit choice
   * instead of silently assuming `defaultType`.
   */
  requireTypeChoice?: boolean
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
  /**
   * TABI-12: prefill props for reviewing/correcting an AI-extracted reservation before it's
   * added to the trip — distinct from `initialStartAt`/`initialTimezone` above, which always
   * carry a real, already-anchored UTC instant. An extraction has no reliable timezone of its
   * own, only the wall-clock date/time as printed on the confirmation, so these are seeded as
   * plain strings and resolved into a real instant at submit time via the normal address
   * geocoding path — exactly as if the user had typed them in by hand.
   */
  defaultStaySubtype?: StaySubtype
  initialName?: string | null
  initialStartAddressText?: string | null
  initialEndAddressText?: string | null
  initialStartDate?: string | null
  initialStartTime?: string | null
  initialEndDate?: string | null
  initialEndTime?: string | null
  initialPriceAmount?: number | null
  initialConfirmationNumber?: string | null
  initialNote?: string | null
  extractionNotice?: boolean
  /**
   * TABI-210: "Confirm all" fast path from ImportPlanModal's bulk-review screen — fires the same
   * submit a manual Save click would (once, on mount) instead of waiting for the user to open the
   * form and press Save themselves. Reuses handleSubmit as-is, so every safety check downstream
   * (geocoding, overlap/out-of-period/location-mismatch confirms, required-field validation)
   * still runs and still pauses on its own dialog/error exactly as it would for a manual submit —
   * this only skips the "user notices the form and clicks Save" step for a clean, unambiguous item.
   */
  autoSubmit?: boolean
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

export function AddReservationModal({
  tripId,
  defaultType = 'stay',
  defaultStaySubtype = 'hotel',
  defaultTransportSubtype = 'point_to_point',
  requireTypeChoice = false,
  initialStartAt = null,
  initialTimezone = null,
  initialEndAt = null,
  initialEndTimezone = null,
  initialStartPlace = null,
  initialEndPlace = null,
  initialName = null,
  initialStartAddressText = null,
  initialEndAddressText = null,
  initialStartDate = null,
  initialStartTime = null,
  initialEndDate = null,
  initialEndTime = null,
  initialPriceAmount = null,
  initialConfirmationNumber = null,
  initialNote = null,
  extractionNotice = false,
  autoSubmit = false,
  onClose,
  onCreate,
}: AddReservationModalProps) {
  const computedEndDateId = useId()
  const computedEndTimeId = useId()
  const [mainType, setMainType] = useState<ReservationType>(defaultType)
  // TABI-126: the add sheet inherits its type from the menu it was opened from (Stay/Transport/
  // Activities) instead of re-asking — the selector stays collapsed until "Change type" is used.
  // TABI-54: except when there's no such origin menu (a free-time block quick-add), where
  // `requireTypeChoice` starts it expanded instead of silently assuming `defaultType`.
  const [typeExpanded, setTypeExpanded] = useState(requireTypeChoice)
  const [staySubtype, setStaySubtype] = useState<StaySubtype>(defaultStaySubtype)
  // TABI-121: Transport's own sub-type (point-to-point vs vehicle rental), symmetric to Stay's —
  // shown whenever the main type is Transport, not folded into the main type selector.
  const [transportSubtype, setTransportSubtype] = useState<TransportSubtype>(defaultTransportSubtype)
  const [parkingIncluded, setParkingIncluded] = useState<boolean | null>(null)
  const [checkInDeadline, setCheckInDeadline] = useState('')
  const [name, setName] = useState(initialName ?? '')
  // TABI-203: once the user (or an AI extraction) has put something explicit into the name
  // field, sub-type changes stop overwriting it — mirrors the "only while untouched" guard
  // used for the start-date/location prefills below.
  const [nameManuallyEdited, setNameManuallyEdited] = useState(Boolean(initialName))
  const [status, setStatus] = useState<ReservationStatus>('to_book')
  const [startAddress, setStartAddress] = useState(
    () => initialStartPlace?.formattedAddress ?? initialStartAddressText ?? '',
  )
  const [endAddress, setEndAddress] = useState(
    () => initialEndPlace?.formattedAddress ?? initialEndAddressText ?? '',
  )
  const [startPlace, setStartPlace] = useState<ResolvedPlace | null>(() => initialStartPlace)
  const [endPlace, setEndPlace] = useState<ResolvedPlace | null>(() => initialEndPlace)
  const [startDate, setStartDate] = useState(() =>
    initialStartAt ? localDateKey(initialStartAt, initialTimezone) : (initialStartDate ?? ''),
  )
  const [startTime, setStartTime] = useState(() =>
    initialStartAt ? localTimeKey(initialStartAt, initialTimezone) : (initialStartTime ?? ''),
  )
  const [endDate, setEndDate] = useState(() =>
    initialEndAt ? localDateKey(initialEndAt, initialEndTimezone ?? initialTimezone) : (initialEndDate ?? ''),
  )
  const [endTime, setEndTime] = useState(() =>
    initialEndAt ? localTimeKey(initialEndAt, initialEndTimezone ?? initialTimezone) : (initialEndTime ?? ''),
  )
  const [nights, setNights] = useState('')
  // An extracted checkout date/time is already explicit — skip the nights-derivation default
  // (TABI-112) so it isn't immediately overwritten by the nights-derivation effect below.
  const [manualEndDate, setManualEndDate] = useState(() => Boolean(initialEndDate))
  // TABI-181: Activity has no end-date picker at all — end is always derived from start +
  // duration, on the same calendar day (same simplification as nights-for-Stay, TABI-112).
  const [durationHours, setDurationHours] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  // TABI-203: default the price to 0 rather than leaving it blank — still freely editable.
  const [priceAmount, setPriceAmount] = useState(() => (initialPriceAmount != null ? String(initialPriceAmount) : '0'))
  const [confirmationNumber, setConfirmationNumber] = useState(initialConfirmationNumber ?? '')
  const [note, setNote] = useState(initialNote ?? '')
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
    field: OutOfPeriodField
  } | null>(null)
  const [locationMismatchConfirm, setLocationMismatchConfirm] = useState<{
    input: Omit<NewReservation, 'trip_id'>
    mismatch: LocationMismatch
  } | null>(null)
  // TABI-9: when geocoding hard-fails (address not found — not the ambiguous-candidates case,
  // which useAddressPicker already handles), offer to save with the free-text address as-is
  // rather than blocking the reservation entirely. Never silent: this is an explicit confirm,
  // same philosophy as the overlap/out-of-period/location-mismatch confirms below.
  const [geocodeFailureConfirm, setGeocodeFailureConfirm] = useState<{
    fields: Array<'start' | 'end'>
    startGeo: ResolvedPlace | null
    endGeo: ResolvedPlace | null
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
    // Departure time is never hard-required — a missing one now falls back to the trip's
    // day-start time (see buildAndProceed) instead of blocking submission, mirroring how Stay's
    // check-in time already works. Kept as its own field (rather than deleted) since it still
    // governs the start time input's (inert, noValidate-bypassed) `required` attribute.
    requiresStartTime: false,
    requiresEnd: mainType !== 'activity',
    requiresEndTime: isPointToPoint,
  }
  // TABI-122: point-to-point transport has no free-text name — it's derived from the route.
  const isAutoNamedTransport = isPointToPoint

  // TABI-203: suggest a starting name derived from the chosen sub-type (e.g. "New Hotel")
  // instead of leaving the field blank, re-suggesting whenever the type/sub-type changes —
  // but only until the user actually types their own name in the field.
  useEffect(() => {
    if (nameManuallyEdited || isAutoNamedTransport) return
    const subtypeLabel =
      option.dbType === 'stay'
        ? strings.addReservation.staySubtypes[staySubtype]
        : isAtDisposal
          ? strings.addReservation.transportSubtypes.at_disposal
          : option.dbType === 'activity'
            ? strings.reservationType.activity
            : null
    if (subtypeLabel) setName(strings.addReservation.suggestedName(subtypeLabel))
  }, [nameManuallyEdited, isAutoNamedTransport, option.dbType, isAtDisposal, staySubtype])
  // Overlap detection (TABI-108) only applies within Stay or within Transport — fetch
  // whichever type is currently selected so switching type mid-form checks against the right set.
  const { reservations: sameTypeReservations, loading: sameTypeLoading } = useReservationsByType(
    tripId,
    option.dbType,
  )
  const { trip, loading: tripLoading, error: tripError, updateDates: updateTripDates } = useTrip(tripId)
  const { locationsByDate: dayLocationsByDate } = useTripDayLocations(tripId)
  // TABI-204: last-known-location prefill draws from every reservation in the trip
  // (not just the current type), since the goal is "where did the traveler's plan
  // leave off", regardless of what kind of booking put them there.
  const { reservations: allTripReservations, loading: allTripReservationsLoading } = useTripReservations(tripId)

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

  // TABI-204: prefill the start address with the trip's last known location — its most
  // recently-dated planned day-location or geocoded reservation address — so back-to-back
  // reservations in the same area don't start from a blank field. Only while the field is
  // still untouched (covers the plain "Add" entry point; the AI-extraction and Getting-Around
  // prefill paths above already seed a non-empty value via `initialStart*`, so this never
  // overwrites those) and applied once, same guard shape as the TABI-111 start-date prefill.
  const hasPrefilledLocationRef = useRef(false)
  useEffect(() => {
    if (hasPrefilledLocationRef.current) return
    if (allTripReservationsLoading) return
    if (startAddress !== '') return

    const known = lastKnownTripLocation(allTripReservations, dayLocationsByDate)
    if (known) {
      setStartAddress(known.formattedAddress)
      setStartPlace({
        lat: known.lat,
        lng: known.lng,
        formattedAddress: known.formattedAddress,
        timezone: known.timezone ?? localTimeZone(),
        city: known.city,
        placeName: known.placeName,
      })
      hasPrefilledLocationRef.current = true
    }
  }, [allTripReservations, allTripReservationsLoading, dayLocationsByDate, startAddress])

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

  // TABI-181: for Activity, derive end date/time from start + duration instead of asking for
  // an end date directly — end always stays on the same calendar day as start.
  useEffect(() => {
    if (option.dbType !== 'activity') return
    const hours = Number(durationHours) || 0
    const minutes = Number(durationMinutes) || 0
    if (!startDate || !startTime || (hours === 0 && minutes === 0)) {
      setEndDate('')
      setEndTime('')
      return
    }
    setEndDate(startDate)
    setEndTime(addDurationToTime(startTime, hours, minutes))
  }, [option.dbType, startDate, startTime, durationHours, durationMinutes])

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

    // Bug (Bugs DB, 26/08): the trip fetch could still be pending/failed/not-found at
    // submit time, silently skipping outOfPeriodField's check below (it degrades to
    // `null` whenever `trip` is falsy) and any other trip-dependent guard. Fail safe
    // instead of letting a falsy `trip` slip through to that logic.
    if (tripLoading) return
    if (tripError || !trip) {
      setError(strings.addReservation.errorTripLoadFailed)
      return
    }

    if (!isAutoNamedTransport && !name.trim()) {
      setError(strings.addReservation.errorNameRequired)
      return
    }
    // Only the date is ever hard-required here now — a missing start time (Stay's check-in, or
    // a point-to-point Transport departure) always has a default to fall back to, computed in
    // buildAndProceed below.
    if (option.requiresStart && !startDate) {
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
    const notFoundFields: Array<'start' | 'end'> = []
    try {
      if (!startGeo) {
        try {
          const resolved = await resolveAddress(startAddress, requestPick)
          startGeo = resolved ? { ...resolved, placeName: null } : null
        } catch (err) {
          if (!(err instanceof AddressNotFoundError)) throw err
          notFoundFields.push('start')
        }
      }
      if (option.requiresEndAddress && !endGeo) {
        try {
          const resolved = await resolveAddress(endAddress, requestPick)
          endGeo = resolved ? { ...resolved, placeName: null } : null
        } catch (err) {
          if (!(err instanceof AddressNotFoundError)) throw err
          notFoundFields.push('end')
        }
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

    if (notFoundFields.length > 0) {
      setGeocodeFailureConfirm({ fields: notFoundFields, startGeo, endGeo })
      return
    }

    await buildAndProceed(startGeo, endGeo)
  }

  async function handleConfirmGeocodeFailure() {
    if (!geocodeFailureConfirm) return
    const { startGeo, endGeo } = geocodeFailureConfirm
    setGeocodeFailureConfirm(null)
    await buildAndProceed(startGeo, endGeo)
  }

  function handleCancelGeocodeFailure() {
    setGeocodeFailureConfirm(null)
  }

  async function buildAndProceed(startGeo: ResolvedPlace | null, endGeo: ResolvedPlace | null) {
    const startTimezone = startGeo?.timezone ?? initialTimezone ?? localTimeZone()
    const endTimezone = option.requiresEndAddress ? (endGeo?.timezone ?? startTimezone) : startTimezone

    // Vehicle rental collects a date range, not exact times (TABI-123) — anchor to midday so
    // the stored timestamp never drifts to an adjacent calendar day across timezone conversion.
    // TABI-144: Stay check-in/check-out time is optional — fall back to a standard default
    // (14:00/10:00, per TABI-205) when left blank, flagged so the detail screen can surface it as unconfirmed.
    // A point-to-point Transport departure time is optional too — falls back to the trip's own
    // day-start time instead (same field TripLegsSection already anchors a leg quick-add to),
    // flagged the same way so it's never silent about feeding the travel-time calc.
    const startTimeDefaulted = (option.dbType === 'stay' || isPointToPoint) && !startTime
    const endTimeDefaulted = option.dbType === 'stay' && !endTime
    const tripDayStartTime = trip?.day_start_time.slice(0, 5) ?? DAY_START_TIME_FALLBACK
    const effectiveStartTime = isAtDisposal
      ? '12:00'
      : startTimeDefaulted
        ? (option.dbType === 'stay' ? STAY_DEFAULT_CHECK_IN_TIME : tripDayStartTime)
        : startTime
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
      confirmation_number: confirmationNumber.trim() || null,
      note: note.trim() || null,
      price_amount: priceAmount.trim() === '' ? null : Number(priceAmount),
      // TABI-16: no currency selector here — currency is always inherited from the trip.
      price_currency: priceAmount.trim() === '' ? null : (trip?.currency ?? null),
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
      place_google_id: startGeo?.placeDetails?.googlePlaceId ?? null,
      place_rating: startGeo?.placeDetails?.rating ?? null,
      place_user_ratings_total: startGeo?.placeDetails?.userRatingsTotal ?? null,
      place_photo_ref: startGeo?.placeDetails?.photoRef ?? null,
      place_category: startGeo?.placeDetails?.category ?? null,
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
    const field = trip ? outOfPeriodField(input, trip) : null
    if (field) {
      setOutOfPeriodConfirm({ input, field })
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
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('AddReservationModal.submitReservation', err)
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
    } catch (err) {
      logClientError('AddReservationModal.handleExtendTrip', err)
      setError(strings.addReservation.errorGeneric)
      setSubmitting(false)
      return
    }
    // Bug (Bugs DB, "L'UI devient totalement non cliquable..."): `submitting` must drop back
    // to false as soon as this PATCH resolves, before handing off to whatever comes next —
    // proceedAfterOutOfPeriodCheck may open another ConfirmDialog (location mismatch) instead
    // of calling submitReservation, and every ConfirmDialog/FormSheet button is disabled while
    // `submitting` is true. Leaving it true here left that next dialog's own buttons (and the
    // form's Cancel/Submit) permanently disabled — no confirm, no cancel, no way out but a
    // refresh. submitReservation still sets it back to true itself if a real save follows.
    setSubmitting(false)
    setOutOfPeriodConfirm(null)
    await proceedAfterOutOfPeriodCheck(input)
  }

  // Bug: "Outside trip dates" ne permet pas de revenir en arrière (Bugs DB, 25/08) — dismisses
  // the dialog without saving anything and returns focus to the field that triggered it, so the
  // only ways forward are correcting the date or explicitly extending the trip.
  function handleGoBackFromOutOfPeriod() {
    if (!outOfPeriodConfirm) return
    const { field } = outOfPeriodConfirm
    setOutOfPeriodConfirm(null)
    const hasEditableEndDateField = option.dbType !== 'activity' && (option.dbType !== 'stay' || manualEndDate)
    const targetId = field === 'end' && hasEditableEndDateField ? END_DATE_FIELD_ID : START_DATE_FIELD_ID
    // Wait a tick for the dialog to unmount before moving focus.
    requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus()
    })
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

  const hasAutoSubmittedRef = useRef(false)
  useEffect(() => {
    if (!autoSubmit || hasAutoSubmittedRef.current) return
    // Wait for the trip fetch to resolve (success or failure) before consuming the one-shot
    // ref below — otherwise a still-pending fetch at mount time would make handleSubmit's
    // new tripLoading guard no-op this silently, with no later retry.
    if (tripLoading) return
    hasAutoSubmittedRef.current = true
    void handleSubmit({ preventDefault: () => {} } as FormEvent)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once (per trip-load resolution) only, guarded by the ref above
  }, [autoSubmit, tripLoading])

  return (
    <>
      <FormSheet
        title={strings.addReservation.title}
        onSubmit={handleSubmit}
        onClose={onClose}
        cancelLabel={strings.addReservation.cancel}
        submitLabel={strings.addReservation.submit}
        submitting={submitting}
        submitDisabled={geocoding || tripLoading || Boolean(tripError)}
      >
        {extractionNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {strings.addReservation.extractionNoticeBanner}
          </div>
        )}

        {tripError && (
          <p className="text-sm text-red-600">{strings.addReservation.errorTripLoadFailed}</p>
        )}

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
              onChange={(event) => {
                setName(event.target.value)
                setNameManuallyEdited(true)
              }}
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
            id={START_DATE_FIELD_ID}
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
            id={START_DATE_FIELD_ID}
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
                    id={computedEndDateId}
                    name={computedEndDateId}
                    type="date"
                    aria-label={`${strings.addReservation.endLabel} date`}
                    value={endDate}
                    disabled
                    className="w-1/2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-500"
                  />
                  <input
                    id={computedEndTimeId}
                    name={computedEndTimeId}
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
        ) : option.dbType === 'activity' ? (
          <DurationField
            legend={strings.addReservation.durationLabel}
            hours={durationHours}
            minutes={durationMinutes}
            onHoursChange={setDurationHours}
            onMinutesChange={setDurationMinutes}
          />
        ) : (
          <div className="space-y-2">
            {isAtDisposal ? (
              <DateField
                legend={strings.addReservation.endLabel}
                date={endDate}
                onDateChange={setEndDate}
                required={option.requiresEnd}
                min={startDate}
                id={END_DATE_FIELD_ID}
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
                min={startDate}
                id={END_DATE_FIELD_ID}
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

        {/* TABI-16: no currency selector here — currency is always inherited from the trip. */}
        <Field label={strings.addReservation.priceLabel}>
          <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-teal-600">
            <input
              type="number"
              step="0.01"
              value={priceAmount}
              onChange={(event) => setPriceAmount(event.target.value)}
              className="w-full text-sm focus:outline-none"
            />
            {trip?.currency && <span className="shrink-0 text-sm text-slate-500">{trip.currency}</span>}
          </div>
        </Field>

        <Field label={strings.addReservation.confirmationNumberLabel}>
          <input
            type="text"
            value={confirmationNumber}
            onChange={(event) => setConfirmationNumber(event.target.value)}
            placeholder={strings.addReservation.confirmationNumberPlaceholder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
        </Field>

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
          cancelLabel={strings.addReservation.outOfPeriodCancelCta}
          onCancel={handleGoBackFromOutOfPeriod}
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
      {geocodeFailureConfirm && (
        <ConfirmDialog
          title={strings.addReservation.geocodeFailureConfirmTitle}
          message={strings.addReservation.geocodeFailureConfirmMessage(
            describeGeocodeFailureFields(geocodeFailureConfirm.fields),
          )}
          confirmLabel={strings.addReservation.geocodeFailureConfirmCta}
          onConfirm={handleConfirmGeocodeFailure}
          cancelLabel={strings.addReservation.geocodeFailureCancelCta}
          onCancel={handleCancelGeocodeFailure}
          confirming={submitting}
        />
      )}
    </>
  )
}

function describeGeocodeFailureFields(fields: Array<'start' | 'end'>): string {
  if (fields.length === 2) return 'start and end addresses'
  return fields[0] === 'start' ? 'start address' : 'end address'
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

function DateField({
  legend,
  date,
  onDateChange,
  required,
  min,
  id,
}: {
  legend: string
  date: string
  onDateChange: (value: string) => void
  required: boolean
  min?: string
  id?: string
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return (
    <fieldset className="flex-1">
      <legend className="mb-1 block text-sm font-medium text-slate-700">{legend}</legend>
      <input
        id={fieldId}
        name={fieldId}
        type="date"
        aria-label={`${legend} date`}
        value={date}
        onChange={(event) => onDateChange(event.target.value)}
        required={required}
        min={min || undefined}
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
  min,
  id,
}: {
  legend: string
  date: string
  time: string
  onDateChange: (value: string) => void
  onTimeChange: (value: string) => void
  dateRequired: boolean
  timeRequired: boolean
  min?: string
  id?: string
}) {
  const generatedDateId = useId()
  const timeId = useId()
  const dateId = id ?? generatedDateId
  return (
    <fieldset className="flex-1">
      <legend className="mb-1 block text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex gap-2">
        <input
          id={dateId}
          name={dateId}
          type="date"
          aria-label={`${legend} date`}
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
          required={dateRequired}
          min={min || undefined}
          className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
        <input
          id={timeId}
          name={timeId}
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

// TABI-181: Activity's end is always derived (start + duration) — this replaces the end
// DateTimeField for that type only, with no date picker at all.
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
  const hoursId = useId()
  const minutesId = useId()
  return (
    <fieldset className="flex-1">
      <legend className="mb-1 block text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex gap-2">
        <input
          id={hoursId}
          name={hoursId}
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
          id={minutesId}
          name={minutesId}
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
