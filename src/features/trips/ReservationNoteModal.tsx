import { useState, type FormEvent } from 'react'
import { FormSheet } from '../../components/ui/FormSheet'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { Reservation } from '../../types/reservation'

interface ReservationNoteModalProps {
  reservation: Reservation
  onSave: (reservationId: string, note: string) => Promise<void>
  onClose: () => void
}

/**
 * Desktop-only large note editor (Backlog: "grande fenêtre sur desktop") —
 * same underlying `note` column and save path as ReservationNotePopup, just a
 * near-fullscreen FormSheet instead of the small sheet mobile keeps using.
 * Unlike the small popup, closing with unsaved text asks for confirmation
 * first (Cancel, Escape, or the header's own close affordance all funnel
 * through the same check).
 */
export function ReservationNoteModal({ reservation, onSave, onClose }: ReservationNoteModalProps) {
  const [text, setText] = useState(reservation.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = text !== (reservation.note ?? '')

  function requestClose() {
    if (dirty && !window.confirm(strings.reservationNote.discardChangesConfirm)) return
    onClose()
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(reservation.id, text)
      showSavedToast(strings.common.saved)
      onClose()
    } catch (err) {
      logClientError('ReservationNoteModal.handleSubmit', err)
      setError(strings.reservationNote.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet
      title={strings.reservationNote.title(reservation.name)}
      onSubmit={handleSubmit}
      onClose={requestClose}
      cancelLabel={strings.reservationNote.cancel}
      submitLabel={strings.reservationNote.save}
      submitting={saving}
      size="large"
      closeOnEscape
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={strings.reservationDetail.notesPlaceholder}
        className="min-h-0 flex-1 resize-none rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-teal-600 focus:outline-none"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </FormSheet>
  )
}
