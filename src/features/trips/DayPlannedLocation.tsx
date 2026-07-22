import { useState } from 'react'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { Button } from '../../components/ui/Button'
import { PlaceAutocompleteField, type PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { AddressSelectionCancelledError, fetchGeocodeByPlaceId, resolveAddress, type GeocodeResult } from '../../lib/geocode'
import { strings } from '../../lib/strings'
import type { TripDayLocation } from '../../types/dayLocation'
import { useAddressPicker } from '../reservations/useAddressPicker'
import type { DayLocationInput } from './useTripDayLocations'

interface DayPlannedLocationProps {
  dayKey: string
  location: TripDayLocation | null
  onSave: (input: DayLocationInput) => Promise<void>
  onClear: () => Promise<void>
}

/**
 * Lightweight per-day "planned location" widget (TABI-114) — an approximate
 * city/zone for a day, independent of any reservation. Used to seed the
 * Overview map (TABI-115) and later flag mismatches (TABI-116) before real
 * bookings exist for that day.
 */
export function DayPlannedLocation({ dayKey, location, onSave, onClear }: DayPlannedLocationProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [pendingPlace, setPendingPlace] = useState<(GeocodeResult & { placeName: string | null }) | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { candidates, requestPick, selectCandidate, cancelPick } = useAddressPicker()

  function startEditing() {
    setText(location?.place_name ?? '')
    setPendingPlace(null)
    setError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setError(null)
  }

  function handleTextChange(value: string) {
    setText(value)
    setPendingPlace(null)
  }

  async function handlePlaceSelect({ placeId, placeName, text: selectedText }: PlaceAutocompleteSelection) {
    setError(null)
    try {
      const result = await fetchGeocodeByPlaceId(placeId)
      setPendingPlace({ ...result, placeName: placeName ?? selectedText })
    } catch {
      setError(strings.dayLocation.errorGeneric)
    }
  }

  async function commit(input: DayLocationInput) {
    setSaving(true)
    try {
      await onSave(input)
      setEditing(false)
    } catch {
      setError(strings.dayLocation.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setError(null)

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
      setError(
        err instanceof AddressSelectionCancelledError
          ? strings.addressPicker.selectionRequiredError
          : strings.dayLocation.errorGeneric,
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    setError(null)
    try {
      await onClear()
      setEditing(false)
    } catch {
      setError(strings.dayLocation.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return location ? (
      <button
        type="button"
        onClick={startEditing}
        className="flex max-w-full items-center gap-1.5 truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
      >
        <span aria-hidden="true">📍</span>
        <span className="truncate">{location.place_name}</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={startEditing}
        className="rounded-full px-3 py-1 text-xs font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        {strings.dayLocation.addCta}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <PlaceAutocompleteField
        id={`day-location-${dayKey}`}
        label={strings.dayLocation.label}
        value={text}
        onTextChange={handleTextChange}
        onPlaceSelect={handlePlaceSelect}
        placeholder={strings.dayLocation.placeholder}
      />
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        {location ? (
          <Button
            type="button"
            variant="secondary"
            onClick={handleRemove}
            disabled={saving}
            className="text-red-600 hover:bg-red-50"
          >
            {strings.dayLocation.remove}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={cancelEditing} disabled={saving}>
            {strings.dayLocation.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || (!text.trim() && !pendingPlace)}>
            {saving ? strings.dayLocation.geocoding : strings.dayLocation.save}
          </Button>
        </div>
      </div>
      {candidates && (
        <AddressCandidatePicker candidates={candidates} onSelect={selectCandidate} onCancel={cancelPick} />
      )}
    </div>
  )
}
