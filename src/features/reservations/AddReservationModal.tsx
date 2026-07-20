import { APIProvider } from '@vis.gl/react-google-maps'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import type { PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { PlaceAutocompleteField } from '../../components/ui/PlaceAutocompleteField'
import { StatusPicker } from '../../components/ui/StatusPicker'
import { localTimeZone, zonedTimeToUtc } from '../../lib/datetime'
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
  TransportSubtype,
} from '../../types/reservation'
import { addDays, computeAccommodationGaps } from '../stay/computeAccommodationGaps'
import { useTrip } from '../trips/useTrip'
import { findOverlappingReservation } from './reservationOverlap'
import { useAddressPicker } from './useAddressPicker'
import { useReservationsByType } from './useReservationsByType'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

type ResolvedPlace = GeocodeResult & { placeName: string | null }

type UiReservationType = 'hotel' | 'flight' | 'train' | 'local_transport' | 'car_rental' | 'activity'

interface TypeOption {
  value: UiReservationType
  dbType: ReservationType
  transportSubtype: TransportSubtype | null
  requiresEndAddress: boolean
  requiresStart: boolean
  requiresEnd: boolean
}

const typeOptions: TypeOption[] = [
  {
    value: 'hotel',
    dbType: 'stay',
    transportSubtype: null,
    requiresEndAddress: false,
    requiresStart: true,
    requiresEnd: true,
  },
  {
    value: 'flight',
    dbType: 'transport',
    transportSubtype: 'point_to_point',
    requiresEndAddress: true,
    requiresStart: true,
    requiresEnd: true,
  },
  {
    value: 'train',
    dbType: 'transport',
    transportSubtype: 'point_to_point',
    requiresEndAddress: true,
    requiresStart: true,
    requiresEnd: true,
  },
  {
    value: 'local_transport',
    dbType: 'transport',
    transportSubtype: 'point_to_point',
    requiresEndAddress: true,
    requiresStart: true,
    requiresEnd: true,
  },
  {
    value: 'car_rental',
    dbType: 'transport',
    transportSubtype: 'at_disposal',
    requiresEndAddress: true,
    requiresStart: true,
    requiresEnd: true,
  },
  {
    value: 'activity',
    dbType: 'activity',
    transportSubtype: null,
    requiresEndAddress: false,
    requiresStart: false,
    requiresEnd: false,
  },
]

interface AddReservationModalProps {
  tripId: string
  defaultType?: UiReservationType
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

export function AddReservationModal({ tripId, defaultType = 'hotel', onClose, onCreate }: AddReservationModalProps) {
  const [uiType, setUiType] = useState<UiReservationType>(defaultType)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<ReservationStatus>('to_book')
  const [startAddress, setStartAddress] = useState('')
  const [endAddress, setEndAddress] = useState('')
  const [startPlace, setStartPlace] = useState<ResolvedPlace | null>(null)
  const [endPlace, setEndPlace] = useState<ResolvedPlace | null>(null)
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
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
  const { candidates, requestPick, selectCandidate, cancelPick } = useAddressPicker()

  const option = typeOptions.find((candidate) => candidate.value === uiType) ?? typeOptions[0]
  // Overlap detection (TABI-108) only applies within Stay or within Transport — fetch
  // whichever type is currently selected so switching type mid-form checks against the right set.
  const { reservations: sameTypeReservations, loading: sameTypeLoading } = useReservationsByType(
    tripId,
    option.dbType,
  )
  const { trip, loading: tripLoading } = useTrip(tripId)

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

    if (!name.trim()) {
      setError(strings.addReservation.errorNameRequired)
      return
    }
    if (option.requiresStart && (!startDate || !startTime)) {
      setError(strings.addReservation.errorStartRequired)
      return
    }
    if (option.requiresEnd) {
      if (option.dbType === 'stay' && !manualEndDate) {
        if (!nights.trim() || Number(nights) < 1 || !endTime) {
          setError(strings.addReservation.errorNightsRequired)
          return
        }
      } else if (!endDate || !endTime) {
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
          : err instanceof Error
            ? err.message
            : strings.addReservation.errorGeneric,
      )
      setGeocoding(false)
      return
    }
    setGeocoding(false)

    const startTimezone = startGeo?.timezone ?? localTimeZone()
    const endTimezone = option.requiresEndAddress ? (endGeo?.timezone ?? startTimezone) : startTimezone

    const startAt = startDate && startTime ? zonedTimeToUtc(startDate, startTime, startTimezone) : null
    const endAt = endDate && endTime ? zonedTimeToUtc(endDate, endTime, endTimezone) : null

    if (startAt && endAt && endAt < startAt) {
      setError(strings.addReservation.errorEndBeforeStart)
      return
    }

    const input: Omit<NewReservation, 'trip_id'> = {
      type: option.dbType,
      transport_subtype: option.transportSubtype,
      name: name.trim(),
      status,
      note: note.trim() || null,
      price_amount: priceAmount.trim() === '' ? null : Number(priceAmount),
      price_currency: priceCurrency.trim() || null,
      start_at: startAt,
      end_at: endAt,
      start_address: startGeo?.formattedAddress ?? (startAddress.trim() || null),
      start_lat: startGeo?.lat ?? null,
      start_lng: startGeo?.lng ?? null,
      start_place_name: startGeo?.placeName ?? null,
      start_timezone: startAt ? startTimezone : null,
      end_address: option.requiresEndAddress ? (endGeo?.formattedAddress ?? (endAddress.trim() || null)) : null,
      end_lat: option.requiresEndAddress ? (endGeo?.lat ?? null) : null,
      end_lng: option.requiresEndAddress ? (endGeo?.lng ?? null) : null,
      end_place_name: option.requiresEndAddress ? (endGeo?.placeName ?? null) : null,
      end_timezone: endAt ? endTimezone : null,
    }

    if (startAt && endAt && option.dbType !== 'activity') {
      const overlapping = findOverlappingReservation({ start_at: startAt, end_at: endAt }, sameTypeReservations)
      if (overlapping) {
        setOverlapConfirm({ reservation: overlapping, input })
        return
      }
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
    await submitReservation(input)
  }

  function handleCancelOverlap() {
    setOverlapConfirm(null)
    setOverlapNote('')
  }

  return (
    <APIProvider apiKey={mapsApiKey ?? ''}>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
        <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">{strings.addReservation.title}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label={strings.addReservation.typeLabel}>
              <select
                value={uiType}
                onChange={(event) => setUiType(event.target.value as UiReservationType)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              >
                {typeOptions.map((candidate) => (
                  <option key={candidate.value} value={candidate.value}>
                    {strings.addReservation.types[candidate.value]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={strings.addReservation.nameLabel}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={strings.addReservation.namePlaceholder}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </Field>

            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">{strings.addReservation.statusLabel}</p>
              <StatusPicker value={status} onChange={setStatus} />
            </div>

            <PlaceAutocompleteField
              id="start-address"
              label={
                option.transportSubtype === 'at_disposal'
                  ? strings.addReservation.startAddressLabelAtDisposal
                  : option.requiresEndAddress
                    ? strings.addReservation.startAddressLabelTransport
                    : strings.addReservation.startAddressLabel
              }
              value={startAddress}
              onTextChange={handleStartAddressChange}
              onPlaceSelect={handleStartPlaceSelect}
            />

            {option.requiresEndAddress && (
              <PlaceAutocompleteField
                id="end-address"
                label={
                  option.transportSubtype === 'at_disposal'
                    ? strings.addReservation.endAddressLabelAtDisposal
                    : strings.addReservation.endAddressLabel
                }
                value={endAddress}
                onTextChange={handleEndAddressChange}
                onPlaceSelect={handleEndPlaceSelect}
              />
            )}

            <DateTimeField
              legend={strings.addReservation.startLabel}
              date={startDate}
              time={startTime}
              onDateChange={setStartDate}
              onTimeChange={setStartTime}
              required={option.requiresStart}
            />

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
                        required={option.requiresEnd}
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
                <DateTimeField
                  legend={strings.addReservation.endLabel}
                  date={endDate}
                  time={endTime}
                  onDateChange={setEndDate}
                  onTimeChange={setEndTime}
                  required={option.requiresEnd}
                />
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

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                {strings.addReservation.cancel}
              </Button>
              <Button type="submit" disabled={submitting || geocoding}>
                {strings.addReservation.submit}
              </Button>
            </div>
          </form>
        </div>
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
      </div>
    </APIProvider>
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

function DateTimeField({
  legend,
  date,
  time,
  onDateChange,
  onTimeChange,
  required,
}: {
  legend: string
  date: string
  time: string
  onDateChange: (value: string) => void
  onTimeChange: (value: string) => void
  required: boolean
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
          required={required}
          className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
        <input
          type="time"
          aria-label={`${legend} time`}
          value={time}
          onChange={(event) => onTimeChange(event.target.value)}
          required={required}
          className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </div>
    </fieldset>
  )
}
