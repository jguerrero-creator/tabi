import { useState, type FormEvent } from 'react'
import { FormSheet } from '../../components/ui/FormSheet'
import { extractReservationFromText } from '../../lib/extractReservation'
import { strings } from '../../lib/strings'
import type { NewReservation, Reservation } from '../../types/reservation'
import { useTrip } from '../trips/useTrip'
import { AddReservationModal } from './AddReservationModal'
import { mapExtractedReservation, type ExtractedReservationPrefill } from './mapExtractedReservation'

interface QuickAddModalProps {
  tripId: string
  onClose: () => void
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

// TABI-194: ultra-fast placeholder creation — a single free-text line (e.g. "Hotel in Kyoto,
// Aug 10-14") through the SAME extraction pipeline and review screen as ImportConfirmationModal
// (TABI-8/12), not a separate quick-add engine. AddReservationModal already defaults status to
// "to_book" for every new reservation, so an incomplete extraction naturally lands as "To book"
// with no extra logic needed here.
export function QuickAddModal({ tripId, onClose, onCreate }: QuickAddModalProps) {
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
      setError(strings.quickAdd.errorGeneric)
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
        initialEndAddressText={prefill.initialEndAddressText}
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
      title={strings.quickAdd.title}
      onSubmit={handleExtract}
      onClose={onClose}
      cancelLabel={strings.quickAdd.cancel}
      submitLabel={strings.quickAdd.submit}
      submitting={extracting}
      submitDisabled={!text.trim()}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{strings.quickAdd.textLabel}</span>
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={strings.quickAdd.textPlaceholder}
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />
      </label>

      {extracting && <p className="text-sm text-slate-500">{strings.quickAdd.extracting}</p>}

      {error && (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => setManualFallback(true)}
            className="text-sm text-teal-700 underline"
          >
            {strings.quickAdd.manualFallbackCta}
          </button>
        </div>
      )}
    </FormSheet>
  )
}
