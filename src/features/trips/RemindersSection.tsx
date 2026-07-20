import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { strings } from '../../lib/strings'
import type { Reminder } from '../../types/reminder'
import type { ReminderInput } from './useTripReminders'

interface RemindersSectionProps {
  onCreate: (input: ReminderInput) => Promise<Reminder>
}

/**
 * Creation control for "task with date" reminders (TABI-104). Deliberately
 * has no list of its own — reminders are displayed merged into Overview's
 * Needs Attention list, sorted by urgency alongside to-book reservations
 * (TABI-53), so this widget only needs to be the entry point for adding one.
 */
export function RemindersSection({ onCreate }: RemindersSectionProps) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !date) return
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({ title: title.trim(), date })
      setTitle('')
      setDate('')
      setAdding(false)
    } catch {
      setError(strings.reminders.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{strings.reminders.title}</h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-xs font-medium text-teal-700 hover:underline"
        >
          {strings.reminders.addCta}
        </button>
      </div>

      {adding && (
        <form onSubmit={handleSubmit} className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={strings.reminders.titlePlaceholder}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)} disabled={submitting}>
              {strings.reminders.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {strings.reminders.save}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
