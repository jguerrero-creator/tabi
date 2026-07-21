import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { CountryMultiSelect } from '../../components/ui/CountryMultiSelect'
import { CURRENCIES, getDefaultCurrency } from '../../lib/currencies'
import { strings } from '../../lib/strings'
import type { Trip } from '../../types/trip'

const DEFAULT_DAY_START_TIME = '08:00'
const DEFAULT_DAY_END_TIME = '22:00'

export interface TripFormValues {
  name: string
  start_date: string | null
  end_date: string | null
  destinations: string[]
  currency: string
  day_start_time: string
  day_end_time: string
  note: string | null
}

interface TripFormModalProps {
  trip?: Trip
  onClose: () => void
  onSubmit: (input: TripFormValues) => Promise<Trip>
}

export function TripFormModal({ trip, onClose, onSubmit }: TripFormModalProps) {
  const isEditing = trip !== undefined
  const [name, setName] = useState(trip?.name ?? '')
  const [startDate, setStartDate] = useState(trip?.start_date ?? '')
  const [endDate, setEndDate] = useState(trip?.end_date ?? '')
  const [destinations, setDestinations] = useState<string[]>(trip?.destinations ?? [])
  const [currency, setCurrency] = useState(() => trip?.currency ?? getDefaultCurrency())
  const [dayStartTime, setDayStartTime] = useState(trip?.day_start_time.slice(0, 5) ?? DEFAULT_DAY_START_TIME)
  const [dayEndTime, setDayEndTime] = useState(trip?.day_end_time.slice(0, 5) ?? DEFAULT_DAY_END_TIME)
  const [note, setNote] = useState(trip?.note ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (startDate && endDate && endDate < startDate) {
      setError(strings.createTrip.errorDateRange)
      return
    }

    if (dayEndTime <= dayStartTime) {
      setError(strings.createTrip.errorDayRange)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        destinations,
        currency,
        day_start_time: dayStartTime,
        day_end_time: dayEndTime,
        note: note.trim() || null,
      })
      onClose()
    } catch {
      setError(strings.createTrip.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          {isEditing ? strings.editTrip.title : strings.createTrip.title}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="trip-name" className="mb-1 block text-sm font-medium text-slate-700">
              {strings.createTrip.nameLabel}
            </label>
            <input
              id="trip-name"
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={strings.createTrip.namePlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </div>
          <CountryMultiSelect
            id="trip-destinations"
            label={strings.createTrip.destinationsLabel}
            value={destinations}
            onChange={setDestinations}
            placeholder={strings.createTrip.destinationsPlaceholder}
          />
          <div>
            <label htmlFor="trip-currency" className="mb-1 block text-sm font-medium text-slate-700">
              {strings.createTrip.currencyLabel}
            </label>
            <select
              id="trip-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            >
              {CURRENCIES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} — {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="trip-start" className="mb-1 block text-sm font-medium text-slate-700">
                {strings.createTrip.startLabel}
              </label>
              <input
                id="trip-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="trip-end" className="mb-1 block text-sm font-medium text-slate-700">
                {strings.createTrip.endLabel}
              </label>
              <input
                id="trip-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="trip-day-start" className="mb-1 block text-sm font-medium text-slate-700">
                  {strings.createTrip.dayStartLabel}
                </label>
                <input
                  id="trip-day-start"
                  type="time"
                  required
                  value={dayStartTime}
                  onChange={(event) => setDayStartTime(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="trip-day-end" className="mb-1 block text-sm font-medium text-slate-700">
                  {strings.createTrip.dayEndLabel}
                </label>
                <input
                  id="trip-day-end"
                  type="time"
                  required
                  value={dayEndTime}
                  onChange={(event) => setDayEndTime(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">{strings.createTrip.dayRangeHint}</p>
          </div>

          <div>
            <label htmlFor="trip-note" className="mb-1 block text-sm font-medium text-slate-700">
              {strings.createTrip.notesLabel}
            </label>
            <textarea
              id="trip-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={strings.createTrip.notesPlaceholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              {strings.createTrip.cancel}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {isEditing ? strings.editTrip.submit : strings.createTrip.submit}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
