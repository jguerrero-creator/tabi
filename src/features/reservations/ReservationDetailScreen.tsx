import { APIProvider } from '@vis.gl/react-google-maps'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { Button } from '../../components/ui/Button'
import type { MapPoint } from '../../components/ui/MiniMap'
import { MiniMap } from '../../components/ui/MiniMap'
import type { PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { PlaceAutocompleteField } from '../../components/ui/PlaceAutocompleteField'
import { ReservationTypeIcon } from '../../components/ui/ReservationTypeIcon'
import { Spinner } from '../../components/ui/Spinner'
import { StatusPicker } from '../../components/ui/StatusPicker'
import { formatInZone } from '../../lib/datetime'
import {
  AddressSelectionCancelledError,
  fetchGeocodeByPlaceId,
  resolveAddress,
  type GeocodeCandidate,
  type GeocodeResult,
} from '../../lib/geocode'
import { strings } from '../../lib/strings'
import type { Reservation, ReservationStatus } from '../../types/reservation'
import { transportRouteName } from './transportRouteName'
import { useAddressPicker } from './useAddressPicker'
import { useReservation } from './useReservation'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

type ResolvedPlace = GeocodeResult & { placeName: string | null }

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
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { candidates, requestPick, selectCandidate, cancelPick } = useAddressPicker()

  const [name, setName] = useState(reservation.name)
  const [note, setNote] = useState(reservation.note ?? '')
  const [priceAmount, setPriceAmount] = useState(reservation.price_amount?.toString() ?? '')
  const [priceCurrency, setPriceCurrency] = useState(reservation.price_currency ?? '')
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
    })
  }

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

    let patch: Partial<Reservation> = {
      ...(isAutoNamedTransport ? {} : { name: name.trim() }),
      note: note.trim() || null,
      price_amount: priceAmount.trim() === '' ? null : Number(priceAmount),
      price_currency: priceCurrency.trim() || null,
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
      setFormError(
        err instanceof AddressSelectionCancelledError
          ? strings.addressPicker.selectionRequiredError
          : err instanceof Error
            ? err.message
            : strings.reservationDetail.geocodeErrorGeneric,
      )
      setGeocoding(false)
      return
    }
    setGeocoding(false)

    setSaving(true)
    try {
      await onUpdate(patch)
    } catch {
      setFormError(strings.reservationDetail.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(strings.reservationDetail.deleteConfirm)) return
    setDeleting(true)
    try {
      await onDelete()
    } catch {
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
                <ReservationTypeIcon type={reservation.type} className="h-5 w-5" />
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

          <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
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
              <Field label="Currency" className="w-24">
                <input
                  value={priceCurrency}
                  onChange={(e) => setPriceCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="USD"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-teal-600 focus:outline-none"
                />
              </Field>
            </div>
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
      ? { start_address: null, start_lat: null, start_lng: null, start_timezone: null, start_place_name: null }
      : { end_address: null, end_lat: null, end_lng: null, end_timezone: null, end_place_name: null }
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
      }
    : {
        end_address: geocoded.formattedAddress,
        end_lat: geocoded.lat,
        end_lng: geocoded.lng,
        end_timezone: geocoded.timezone,
        end_place_name: cached?.placeName ?? null,
      }
}

function TypeSpecificZone({ reservation }: { reservation: Reservation }) {
  const legLabels =
    reservation.transport_subtype === 'at_disposal'
      ? strings.reservationLegLabelsAtDisposal
      : strings.reservationLegLabels[reservation.type]

  if (reservation.type === 'transport') {
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <LegRow
          label={legLabels.start}
          placeName={reservation.start_place_name}
          address={reservation.start_address}
          at={reservation.start_at}
          timezone={reservation.start_timezone}
        />
        <LegRow
          label={legLabels.end}
          placeName={reservation.end_place_name}
          address={reservation.end_address}
          at={reservation.end_at}
          timezone={reservation.end_timezone}
        />
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <LegRow
        label={legLabels.start}
        placeName={reservation.start_place_name}
        address={reservation.start_address}
        at={reservation.start_at}
        timezone={reservation.start_timezone}
      />
      {reservation.end_at && (
        <LegRow
          label={legLabels.end}
          placeName={reservation.end_place_name}
          address={reservation.end_address}
          at={reservation.end_at}
          timezone={reservation.end_timezone}
        />
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
}: {
  label: string
  placeName: string | null
  address: string | null
  at: string | null
  timezone: string | null
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-900">{placeName ?? address ?? '—'}</p>
      {address && placeName && <p className="text-xs text-slate-500">{address}</p>}
      {at && <p className="text-xs text-slate-500">{formatInZone(at, timezone)}</p>}
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
