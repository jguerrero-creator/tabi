import { useState, type FormEvent } from 'react'
import { FormSheet } from '../../components/ui/FormSheet'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { Reservation } from '../../types/reservation'

interface ReservationNotePopupProps {
  reservation: Reservation
  onSave: (reservationId: string, note: string) => Promise<void>
  onClose: () => void
}

/**
 * Quick-access popup for a reservation's existing `note` field (TABI backlog:
 * Planning slide-to-reveal / icon-strip) — edits the same underlying column
 * as ReservationDetailScreen's Notes textarea, not a separate notes system.
 */
export function ReservationNotePopup({ reservation, onSave, onClose }: ReservationNotePopupProps) {
  const [text, setText] = useState(reservation.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(reservation.id, text)
      showSavedToast(strings.common.saved)
      onClose()
    } catch (err) {
      logClientError('ReservationNotePopup.handleSubmit', err)
      setError(strings.reservationNote.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet
      title={strings.reservationNote.title(reservation.name)}
      onSubmit={handleSubmit}
      onClose={onClose}
      cancelLabel={strings.reservationNote.cancel}
      submitLabel={strings.reservationNote.save}
      submitting={saving}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={strings.reservationDetail.notesPlaceholder}
        rows={5}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </FormSheet>
  )
}
