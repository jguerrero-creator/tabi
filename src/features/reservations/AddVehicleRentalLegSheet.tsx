import { useState, type FormEvent } from 'react'
import { Field } from '../../components/ui/Field'
import { FormSheet } from '../../components/ui/FormSheet'
import { MiniMap, type MapPoint } from '../../components/ui/MiniMap'
import { PlaceAutocompleteField, type PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { dateKeyOverlapsRange, localDateKey, zonedTimeToUtc } from '../../lib/datetime'
import { fetchGeocodeByPlaceId } from '../../lib/geocode'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import type { Reservation } from '../../types/reservation'
import type { LegPlaceInput, VehicleRentalLegInput } from './useVehicleRentalLegs'

interface AddVehicleRentalLegSheetProps {
  /** The parent Vehicle Rental reservation — supplies the pickup/drop-off range legs must fall within (TABI-127 #4) and the status color for the pin preview. */
  reservation: Reservation
  onSave: (input: VehicleRentalLegInput) => Promise<void>
  onClose: () => void
}

// TABI-127: map-based pin interface reuses PlaceAutocompleteField + MiniMap exactly as
// the reservation detail screen already does for its own start/end address (search-select
// resolves a place via /api/geocode, then MiniMap renders it as a pin) — no new map
// interaction pattern, per the ticket's explicit reuse instruction.
export function AddVehicleRentalLegSheet({ reservation, onSave, onClose }: AddVehicleRentalLegSheetProps) {
  const [date, setDate] = useState('')
  const [departureText, setDepartureText] = useState('')
  const [departurePlace, setDeparturePlace] = useState<LegPlaceInput | null>(null)
  const [departureTime, setDepartureTime] = useState('')
  const [arrivalText, setArrivalText] = useState('')
  const [arrivalPlace, setArrivalPlace] = useState<LegPlaceInput | null>(null)
  const [arrivalTime, setArrivalTime] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeparturePlaceSelect({ placeId, placeName }: PlaceAutocompleteSelection) {
    setGeocoding(true)
    setError(null)
    try {
      const result = await fetchGeocodeByPlaceId(placeId)
      setDeparturePlace({
        placeName: placeName ?? result.formattedAddress,
        address: result.formattedAddress,
        lat: result.lat,
        lng: result.lng,
        timezone: result.timezone,
      })
    } catch (err) {
      logClientError('AddVehicleRentalLegSheet.handleDeparturePlaceSelect', err)
      setError(strings.reservationDetail.geocodeErrorGeneric)
    } finally {
      setGeocoding(false)
    }
  }

  async function handleArrivalPlaceSelect({ placeId, placeName }: PlaceAutocompleteSelection) {
    setGeocoding(true)
    setError(null)
    try {
      const result = await fetchGeocodeByPlaceId(placeId)
      setArrivalPlace({
        placeName: placeName ?? result.formattedAddress,
        address: result.formattedAddress,
        lat: result.lat,
        lng: result.lng,
        timezone: result.timezone,
      })
    } catch (err) {
      logClientError('AddVehicleRentalLegSheet.handleArrivalPlaceSelect', err)
      setError(strings.reservationDetail.geocodeErrorGeneric)
    } finally {
      setGeocoding(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!reservation.start_at || !reservation.end_at || !dateKeyOverlapsRange(date, reservation.start_at, reservation.end_at)) {
      setError(strings.vehicleRentalLegs.errorDateOutOfRange)
      return
    }
    if (!departurePlace || !arrivalPlace) {
      setError(strings.vehicleRentalLegs.errorPlaceRequired)
      return
    }
    const departureAt = zonedTimeToUtc(date, departureTime, departurePlace.timezone)
    const arrivalAt = zonedTimeToUtc(date, arrivalTime, arrivalPlace.timezone)
    if (Date.parse(arrivalAt) <= Date.parse(departureAt)) {
      setError(strings.vehicleRentalLegs.errorArrivalBeforeDeparture)
      return
    }

    setSaving(true)
    try {
      await onSave({
        date,
        departureTime,
        departure: departurePlace,
        arrivalTime,
        arrival: arrivalPlace,
      })
    } catch (err) {
      logClientError('AddVehicleRentalLegSheet.handleSubmit', err)
      setError(strings.vehicleRentalLegs.errorGeneric)
      setSaving(false)
    }
  }

  // Anchored to 'UTC', not the reservation's own start/end timezone: dateKeyOverlapsRange
  // (the actual validation in handleSubmit, shared with findActiveVehicleRental's "covered
  // days" check) treats a plain date-only dateKey as UTC-midnight-anchored. Using the local
  // pickup/drop-off timezone here would let the picker show a boundary date that the real
  // validation then rejects whenever start_at/end_at sit close to a UTC day boundary.
  const minDate = reservation.start_at ? localDateKey(reservation.start_at, 'UTC') : undefined
  const maxDate = reservation.end_at ? localDateKey(reservation.end_at, 'UTC') : undefined

  const points: MapPoint[] = []
  if (departurePlace) {
    points.push({
      lat: departurePlace.lat,
      lng: departurePlace.lng,
      label: strings.vehicleRentalLegs.departureLabel,
      status: reservation.status,
    })
  }
  if (arrivalPlace) {
    points.push({
      lat: arrivalPlace.lat,
      lng: arrivalPlace.lng,
      label: strings.vehicleRentalLegs.arrivalLabel,
      status: reservation.status,
    })
  }

  return (
    <FormSheet
      title={strings.vehicleRentalLegs.addTitle}
      onSubmit={handleSubmit}
      onClose={onClose}
      cancelLabel={strings.vehicleRentalLegs.cancel}
      submitLabel={strings.vehicleRentalLegs.save}
      submitting={saving}
      submitDisabled={geocoding || !date || !departureTime || !arrivalTime || !departurePlace || !arrivalPlace}
    >
      <Field label={strings.vehicleRentalLegs.dateLabel}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          min={minDate}
          max={maxDate}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </Field>

      <PlaceAutocompleteField
        id="vehicle-rental-leg-departure"
        label={strings.vehicleRentalLegs.departurePlaceLabel}
        value={departureText}
        onTextChange={(text) => {
          setDepartureText(text)
          setDeparturePlace(null)
        }}
        onPlaceSelect={handleDeparturePlaceSelect}
      />
      <Field label={strings.vehicleRentalLegs.departureTimeLabel}>
        <input
          type="time"
          value={departureTime}
          onChange={(e) => setDepartureTime(e.target.value)}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </Field>

      <PlaceAutocompleteField
        id="vehicle-rental-leg-arrival"
        label={strings.vehicleRentalLegs.arrivalPlaceLabel}
        value={arrivalText}
        onTextChange={(text) => {
          setArrivalText(text)
          setArrivalPlace(null)
        }}
        onPlaceSelect={handleArrivalPlaceSelect}
      />
      <Field label={strings.vehicleRentalLegs.arrivalTimeLabel}>
        <input
          type="time"
          value={arrivalTime}
          onChange={(e) => setArrivalTime(e.target.value)}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </Field>

      {points.length > 0 && <MiniMap points={points} />}
      {geocoding && <p className="text-sm text-slate-500">{strings.reservationDetail.geocoding}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </FormSheet>
  )
}
