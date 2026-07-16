import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { strings } from '../../lib/strings'
import type { Trip } from '../../types/trip'

interface CreateTripModalProps {
  onClose: () => void
  onCreate: (input: { name: string; start_date: string | null; end_date: string | null }) => Promise<Trip>
}

export function CreateTripModal({ onClose, onCreate }: CreateTripModalProps) {
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (startDate && endDate && endDate < startDate) {
      setError(strings.createTrip.errorDateRange)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await onCreate({
        name: name.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
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
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{strings.createTrip.title}</h2>
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              {strings.createTrip.cancel}
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {strings.createTrip.submit}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
