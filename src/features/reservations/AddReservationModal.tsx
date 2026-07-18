import { useState, type FormEvent } from 'react'
import { AddressCandidatePicker } from '../../components/ui/AddressCandidatePicker'
import { Button } from '../../components/ui/Button'
import { StatusPicker } from '../../components/ui/StatusPicker'
import { localTimeZone, zonedTimeToUtc } from '../../lib/datetime'
import { AddressSelectionCancelledError, resolveAddress } from '../../lib/geocode'
import { strings } from '../../lib/strings'
import type { NewReservation, Reservation, ReservationStatus, ReservationType } from '../../types/reservation'
import { findOverlappingReservation } from './reservationOverlap'
import { useAddressPicker } from './useAddressPicker'
import { useReservationsByType } from './useReservationsByType'

type UiReservationType = 'hotel' | 'flight' | 'train' | 'local_transport' | 'activity'

interface TypeOption {
  value: UiReservationType
  dbType: ReservationType
  requiresEndAddress: boolean
  requiresStart: boolean
  requiresEnd: boolean
}

const typeOptions: TypeOption[] = [
  { value: 'hotel', dbType: 'stay', requiresEndAddress: false, requiresStart: true, requiresEnd: true },
  { value: 'flight', dbType: 'transport', requiresEndAddress: true, requiresStart: true, requiresEnd: true },
  { value: 'train', dbType: 'transport', requiresEndAddress: true, requiresStart: true, requiresEnd: true },
  {
    value: 'local_transport',
    dbType: 'transport',
    requiresEndAddress: true,
    requiresStart: true,
    requiresEnd: true,
  },
  { value: 'activity', dbType: 'activity', requiresEndAddress: false, requiresStart: false, requiresEnd: false },
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
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [priceAmount, setPriceAmount] = useState('')
  const [priceCurrency, setPriceCurrency] = useState('')
  const [note, setNote] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { candidates, requestPick, selectCandidate, cancelPick } = useAddressPicker()

  const option = typeOptions.find((candidate) => candidate.value === uiType) ?? typeOptions[0]
  // Overlap detection (TABI-108) only applies within Stay or within Transport — fetch
  // whichever type is currently selected so switching type mid-form checks against the right set.
  const { reservations: sameTypeReservations } = useReservationsByType(tripId, option.dbType)

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
    if (option.requiresEnd && (!endDate || !endTime)) {
      setError(strings.addReservation.errorEndRequired)
      return
    }

    setGeocoding(true)
    let startGeo: Awaited<ReturnType<typeof resolveAddress>> = null
    let endGeo: Awaited<ReturnType<typeof resolveAddress>> = null
    try {
      startGeo = await resolveAddress(startAddress, requestPick)
      if (option.requiresEndAddress) endGeo = await resolveAddress(endAddress, requestPick)
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

    if (startAt && endAt && option.dbType !== 'activity') {
      const overlapping = findOverlappingReservation({ start_at: startAt, end_at: endAt }, sameTypeReservations)
      if (overlapping) {
        setError(strings.addReservation.errorOverlap(overlapping.name))
        return
      }
    }

    const input: Omit<NewReservation, 'trip_id'> = {
      type: option.dbType,
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
      start_timezone: startAt ? startTimezone : null,
      end_address: option.requiresEndAddress ? (endGeo?.formattedAddress ?? (endAddress.trim() || null)) : null,
      end_lat: option.requiresEndAddress ? (endGeo?.lat ?? null) : null,
      end_lng: option.requiresEndAddress ? (endGeo?.lng ?? null) : null,
      end_timezone: endAt ? endTimezone : null,
    }

    setSubmitting(true)
    try {
      await onCreate(input)
      onClose()
    } catch {
      setError(strings.addReservation.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  return (
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

          <Field
            label={
              option.requiresEndAddress
                ? strings.addReservation.startAddressLabelTransport
                : strings.addReservation.startAddressLabel
            }
          >
            <input
              value={startAddress}
              onChange={(event) => setStartAddress(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </Field>

          {option.requiresEndAddress && (
            <Field label={strings.addReservation.endAddressLabel}>
              <input
                value={endAddress}
                onChange={(event) => setEndAddress(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </Field>
          )}

          <DateTimeField
            legend={strings.addReservation.startLabel}
            date={startDate}
            time={startTime}
            onDateChange={setStartDate}
            onTimeChange={setStartTime}
            required={option.requiresStart}
          />

          <DateTimeField
            legend={strings.addReservation.endLabel}
            date={endDate}
            time={endTime}
            onDateChange={setEndDate}
            onTimeChange={setEndTime}
            required={option.requiresEnd}
          />

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
