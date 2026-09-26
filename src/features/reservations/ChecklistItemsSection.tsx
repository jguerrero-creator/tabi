import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { FormSheet } from '../../components/ui/FormSheet'
import { MiniMap, type MapPoint } from '../../components/ui/MiniMap'
import { Spinner } from '../../components/ui/Spinner'
import { logClientError } from '../../lib/logError'
import { placePhotoUrl } from '../../lib/placesSearch'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { Reservation } from '../../types/reservation'
import type { ResolvedPlace } from './AddReservationModal'
import { ActivityPlaceSearchModal } from './ActivityPlaceSearchModal'
import { useChecklistItems, type NewChecklistItemInput } from './useChecklistItems'

interface ChecklistItemsSectionProps {
  reservation: Reservation
}

type AddStep = 'search' | 'manual' | null

/**
 * Checklist-subtype Activity: the reservation itself is just a time block (e.g.
 * 10:00–15:00 "Nikko") — the candidate places to visit live here as lightweight
 * sub-records, not full Reservations of their own, added via the same rich Places
 * search regular Activities already use. No per-item "done" state, per spec (reference
 * list only) — an item's only actions are rename and remove.
 */
export function ChecklistItemsSection({ reservation }: ChecklistItemsSectionProps) {
  const { items, loading, error, addItem, renameItem, deleteItem } = useChecklistItems(
    reservation.id,
    reservation.trip_id,
  )
  const [addStep, setAddStep] = useState<AddStep>(null)
  const [manualName, setManualName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  async function handleSelectPlace(place: ResolvedPlace) {
    const input: NewChecklistItemInput = {
      name: place.placeName ?? place.formattedAddress,
      place: {
        address: place.formattedAddress,
        lat: place.lat,
        lng: place.lng,
        googlePlaceId: place.placeDetails?.googlePlaceId ?? null,
        category: place.placeDetails?.category ?? null,
        rating: place.placeDetails?.rating ?? null,
        userRatingsTotal: place.placeDetails?.userRatingsTotal ?? null,
        photoRef: place.placeDetails?.photoRef ?? null,
      },
    }
    setSaving(true)
    try {
      await addItem(input)
      setAddStep(null)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('ChecklistItemsSection.handleSelectPlace', err)
      setSaveError(strings.checklistItems.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  async function handleManualSubmit(event: FormEvent) {
    event.preventDefault()
    if (!manualName.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      await addItem({ name: manualName.trim(), place: null })
      setManualName('')
      setAddStep(null)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('ChecklistItemsSection.handleManualSubmit', err)
      setSaveError(strings.checklistItems.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(itemId: string) {
    if (!window.confirm(strings.checklistItems.deleteConfirm)) return
    setDeletingId(itemId)
    try {
      await deleteItem(itemId)
    } catch (err) {
      logClientError('ChecklistItemsSection.handleDelete', err)
    } finally {
      setDeletingId(null)
    }
  }

  function startRename(itemId: string, currentName: string) {
    setEditingId(itemId)
    setEditingName(currentName)
  }

  async function commitRename(itemId: string) {
    const trimmed = editingName.trim()
    setEditingId(null)
    if (!trimmed) return
    try {
      await renameItem(itemId, trimmed)
    } catch (err) {
      logClientError('ChecklistItemsSection.commitRename', err)
    }
  }

  const points: MapPoint[] = items
    .filter((item): item is typeof item & { lat: number; lng: number } => item.lat !== null && item.lng !== null)
    .map((item) => ({ lat: item.lat, lng: item.lng, label: item.name, status: reservation.status }))

  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {strings.checklistItems.title}
        </h2>
        <Button type="button" variant="secondary" onClick={() => setAddStep('search')}>
          {strings.checklistItems.addCta}
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
          <Spinner />
          {strings.checklistItems.loading}
        </div>
      )}

      {!loading && error && <p className="text-sm text-red-600">{strings.checklistItems.errorLoading}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-slate-500">{strings.checklistItems.empty}</p>
      )}

      {!loading && !error && points.length > 0 && <MiniMap points={points} />}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              {item.place_photo_ref ? (
                <img
                  src={placePhotoUrl(item.place_photo_ref, 80)}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="h-10 w-10 flex-shrink-0 rounded-md bg-slate-100" />
              )}
              <div className="min-w-0 flex-1">
                {editingId === item.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => commitRename(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitRename(item.id)
                      }
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-teal-600 focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startRename(item.id, item.name)}
                    aria-label={`${strings.checklistItems.renameLabel}: ${item.name}`}
                    className="truncate text-left text-sm font-medium text-slate-900 hover:underline"
                  >
                    {item.name}
                  </button>
                )}
                {item.address && <p className="truncate text-xs text-slate-500">{item.address}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                disabled={deletingId === item.id}
                aria-label={`${strings.checklistItems.delete} ${item.name}`}
                className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {strings.checklistItems.delete}
              </button>
            </li>
          ))}
        </ul>
      )}

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      {addStep === 'search' && (
        <ActivityPlaceSearchModal
          tripId={reservation.trip_id}
          onSelect={handleSelectPlace}
          onSkip={() => setAddStep('manual')}
          onCancel={() => setAddStep(null)}
        />
      )}

      {addStep === 'manual' && (
        <FormSheet
          title={strings.checklistItems.manualTitle}
          onSubmit={handleManualSubmit}
          onClose={() => setAddStep(null)}
          cancelLabel={strings.checklistItems.cancel}
          submitLabel={strings.checklistItems.save}
          submitting={saving}
          submitDisabled={!manualName.trim()}
        >
          <Field label={strings.checklistItems.manualNameLabel}>
            <input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder={strings.checklistItems.manualNamePlaceholder}
              autoFocus
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </Field>
        </FormSheet>
      )}
    </section>
  )
}
