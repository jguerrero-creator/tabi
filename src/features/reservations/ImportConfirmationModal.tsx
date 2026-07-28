import { useState, type FormEvent } from 'react'
import { FormSheet } from '../../components/ui/FormSheet'
import { extractReservationFromText } from '../../lib/extractReservation'
import { strings } from '../../lib/strings'
import type { NewReservation, Reservation } from '../../types/reservation'
import { useTrip } from '../trips/useTrip'
import { AddReservationModal } from './AddReservationModal'
import { mapExtractedReservation, type ExtractedReservationPrefill } from './mapExtractedReservation'

interface ImportConfirmationModalProps {
  tripId: string
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

// TABI-12: minimal paste-text entry point in front of the extraction endpoint (TABI-8), used
// to exercise the review/correction flow end-to-end. The real upload channels (email/PDF/photo,
// TABI-15/23/58) are separate backlog work — this reuses the same extraction + review pipeline
// they'll eventually feed into.
export function ImportConfirmationModal({ tripId, onClose, onCreate }: ImportConfirmationModalProps) {
  const { trip } = useTrip(tripId)
  const [text, setText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<ExtractedReservationPrefill | null>(null)
  const [manualFallback, setManualFallback] = useState(false)

  async function handleExtract(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setExtracting(true)
    setError(null)
    try {
      const result = await extractReservationFromText(text)
      setPrefill(mapExtractedReservation(result, trip?.currency ?? null))
    } catch {
      // TABI-11: fall back to manual entry rather than dead-ending on an extraction failure.
      setError(strings.importConfirmation.errorGeneric)
    } finally {
      setExtracting(false)
    }
  }

  if (prefill) {
    return (
      <AddReservationModal
        tripId={tripId}
        defaultType={prefill.defaultType}
        requireTypeChoice={prefill.requireTypeChoice}
        defaultStaySubtype={prefill.defaultStaySubtype}
        defaultTransportSubtype={prefill.defaultTransportSubtype}
        initialName={prefill.initialName}
        initialStartAddressText={prefill.initialStartAddressText}
        initialStartDate={prefill.initialStartDate}
        initialStartTime={prefill.initialStartTime}
        initialEndDate={prefill.initialEndDate}
        initialEndTime={prefill.initialEndTime}
        initialPriceAmount={prefill.initialPriceAmount}
        initialNote={prefill.initialNote}
        extractionNotice
        onClose={onClose}
        onCreate={onCreate}
      />
    )
  }

  if (manualFallback) {
    return <AddReservationModal tripId={tripId} requireTypeChoice onClose={onClose} onCreate={onCreate} />
  }

  return (
    <FormSheet
      title={strings.importConfirmation.title}
      onSubmit={handleExtract}
      onClose={onClose}
      cancelLabel={strings.importConfirmation.cancel}
      submitLabel={strings.importConfirmation.submit}
      submitting={extracting}
      submitDisabled={!text.trim()}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {strings.importConfirmation.textLabel}
        </span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={strings.importConfirmation.textPlaceholder}
          rows={10}
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </label>

      {extracting && <p className="text-sm text-slate-500">{strings.importConfirmation.extracting}</p>}

      {error && (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => setManualFallback(true)}
            className="text-sm text-teal-700 underline"
          >
            {strings.importConfirmation.manualFallbackCta}
          </button>
        </div>
      )}
    </FormSheet>
  )
}
