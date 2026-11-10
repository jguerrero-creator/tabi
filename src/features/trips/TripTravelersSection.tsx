import { useId, useState, type KeyboardEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { PlusIcon } from '../../components/ui/PlusIcon'
import { Spinner } from '../../components/ui/Spinner'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import { TRIP_TRAVELER_NAME_MAX_LENGTH, type TripTraveler } from '../../types/tripTraveler'
import { DuplicateTravelerNameError, useTripTravelers } from './useTripTravelers'

interface TripTravelersSectionProps {
  tripId: string
  travelerCount: number
  onTravelerCountBumped: (newCount: number) => void
}

/**
 * Named travelers (TABI-263 Step A) — lives inside the trip's own settings
 * (TripFormModal), not a nav tab (souvenirs-budget-merge-navigation.spec.ts
 * locks the nav down to exactly 5 entries). Writes happen immediately, like
 * souvenir/checklist items (CLAUDE.md #14) — independent of this form's own
 * Save button, since adding a name can need to bump the trip's traveler_count
 * right away (see useTripTravelers).
 *
 * TripFormModal already wraps everything in one <form> (FormSheet) — every
 * control here uses type="button" and intercepts Enter manually rather than
 * nesting a second <form>, which the browser wouldn't actually nest anyway.
 */
export function TripTravelersSection({ tripId, travelerCount, onTravelerCountBumped }: TripTravelersSectionProps) {
  const { travelers, loading, error, createTraveler, renameTraveler, deleteTraveler } = useTripTravelers(
    tripId,
    travelerCount,
    onTravelerCountBumped,
  )
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function handleAdd() {
    const trimmed = newName.trim()
    if (!trimmed) return
    setSubmitting(true)
    setAddError(null)
    try {
      await createTraveler(trimmed)
      setNewName('')
      setAdding(false)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('TripTravelersSection.handleAdd', err)
      setAddError(err instanceof DuplicateTravelerNameError ? strings.tripTravelers.errorDuplicate : strings.tripTravelers.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  function handleAddKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    handleAdd()
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-slate-500">
        <Spinner />
        <p className="text-sm">{strings.tripTravelers.loading}</p>
      </div>
    )
  }

  if (error) {
    return <p className="py-4 text-center text-sm text-red-600">{strings.tripTravelers.errorLoading}</p>
  }

  return (
    <div>
      <p className="mb-1 block text-sm font-medium text-slate-700">{strings.tripTravelers.sectionLabel}</p>
      <p className="mb-2 text-xs text-slate-500">{strings.tripTravelers.hint}</p>

      {travelers.length > 0 && (
        <ul
          aria-label={strings.tripTravelers.listLabel}
          className="mb-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          {travelers.map((traveler) => (
            <TripTravelerRow key={traveler.id} traveler={traveler} onRename={renameTraveler} onDelete={deleteTraveler} />
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder={strings.tripTravelers.namePlaceholder}
            maxLength={TRIP_TRAVELER_NAME_MAX_LENGTH}
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAdding(false)
                setNewName('')
                setAddError(null)
              }}
              disabled={submitting}
            >
              {strings.tripTravelers.cancel}
            </Button>
            <Button type="button" onClick={handleAdd} disabled={submitting || !newName.trim()}>
              {strings.tripTravelers.save}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-teal-700 hover:border-teal-400 hover:bg-teal-50"
        >
          <PlusIcon className="h-4 w-4" />
          {strings.tripTravelers.addCta}
        </button>
      )}
    </div>
  )
}

interface TripTravelerRowProps {
  traveler: TripTraveler
  onRename: (travelerId: string, name: string) => Promise<TripTraveler>
  onDelete: (travelerId: string) => Promise<void>
}

function TripTravelerRow({ traveler, onRename, onDelete }: TripTravelerRowProps) {
  const nameFieldId = useId()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(traveler.name)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEditing() {
    setName(traveler.name)
    setError(null)
    setEditing(true)
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    setError(null)
    try {
      await onRename(traveler.id, trimmed)
      setEditing(false)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('TripTravelerRow.handleSave', err)
      setError(err instanceof DuplicateTravelerNameError ? strings.tripTravelers.errorDuplicate : strings.tripTravelers.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    handleSave()
  }

  async function handleDelete() {
    setSubmitting(true)
    setError(null)
    try {
      await onDelete(traveler.id)
    } catch (err) {
      logClientError('TripTravelerRow.handleDelete', err)
      setError(strings.tripTravelers.errorGeneric)
      setSubmitting(false)
    }
  }

  if (editing) {
    return (
      <li className="px-4 py-3">
        <div className="space-y-2">
          <input
            id={nameFieldId}
            name={nameFieldId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={TRIP_TRAVELER_NAME_MAX_LENGTH}
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              {strings.tripTravelers.cancel}
            </Button>
            <Button type="button" onClick={handleSave} disabled={submitting || !name.trim()}>
              {strings.tripTravelers.save}
            </Button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button type="button" onClick={openEditing} className="min-w-0 flex-1 text-left" aria-label={strings.tripTravelers.edit}>
        <p className="truncate text-sm font-medium text-slate-900">{traveler.name}</p>
      </button>
      {error && <p className="shrink-0 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={submitting}
        aria-label={strings.tripTravelers.delete}
        className="shrink-0 text-lg leading-none text-slate-400 hover:text-red-600"
      >
        ×
      </button>
    </li>
  )
}
