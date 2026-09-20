import { useState } from 'react'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { ExtractedReservation } from '../../types/extractedReservation'
import type { NewReservation, Reservation } from '../../types/reservation'
import { AddReservationModal } from '../reservations/AddReservationModal'
import { mapExtractedReservation } from '../reservations/mapExtractedReservation'
import type { PendingReservationImport } from './usePendingReservationImports'

interface PendingImportsSectionProps {
  tripId: string
  tripCurrency: string | null
  pendingImports: PendingReservationImport[]
  onResolve: (id: string, outcome: 'confirmed' | 'dismissed') => Promise<void>
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

// TABI: review UI for the async import channel — a forwarded booking confirmation
// (api/inbound-email.ts) extracts in the background with nobody watching, so unlike
// every other import channel it can't hand the result straight to a live confirmation
// screen (ImportConfirmationModal). This is that hand-off, deferred to whenever the
// organizer next opens the trip: same AddReservationModal, same
// mapExtractedReservation mapping, same "nothing is added without explicit
// confirmation" rule as any other channel — reviewing (below) is only ever turned
// into a real reservation through the normal Add-sheet save.
export function PendingImportsSection({
  tripId,
  tripCurrency,
  pendingImports,
  onResolve,
  onCreate,
}: PendingImportsSectionProps) {
  const [reviewing, setReviewing] = useState<PendingReservationImport | null>(null)

  async function handleDismiss(id: string) {
    try {
      await onResolve(id, 'dismissed')
    } catch (err) {
      logClientError('PendingImportsSection.handleDismiss', err)
    }
  }

  if (pendingImports.length === 0) return null

  const prefill = reviewing
    ? mapExtractedReservation(reviewing.extracted as unknown as ExtractedReservation, tripCurrency)
    : null

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {strings.pendingImports.title}
      </h2>
      <ul className="divide-y divide-amber-200 overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
        {pendingImports.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {item.subject || strings.pendingImports.noSubject}
              </p>
              <p className="truncate text-xs text-slate-500">{strings.pendingImports.fromLabel(item.sender_email)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => handleDismiss(item.id)}
                className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
              >
                {strings.pendingImports.dismissCta}
              </button>
              <button
                type="button"
                onClick={() => setReviewing(item)}
                className="rounded-full bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800"
              >
                {strings.pendingImports.reviewCta}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {reviewing && prefill && (
        <AddReservationModal
          tripId={tripId}
          defaultType={prefill.defaultType}
          requireTypeChoice={prefill.requireTypeChoice}
          defaultStaySubtype={prefill.defaultStaySubtype}
          defaultTransportSubtype={prefill.defaultTransportSubtype}
          defaultTransportMode={prefill.defaultTransportMode}
          initialName={prefill.initialName}
          initialStartAddressText={prefill.initialStartAddressText}
          initialEndAddressText={prefill.initialEndAddressText}
          initialStartDate={prefill.initialStartDate}
          initialStartTime={prefill.initialStartTime}
          initialEndDate={prefill.initialEndDate}
          initialEndTime={prefill.initialEndTime}
          initialPriceAmount={prefill.initialPriceAmount}
          initialConfirmationNumber={prefill.initialConfirmationNumber}
          initialNote={prefill.initialNote}
          extractionNotice
          onClose={() => setReviewing(null)}
          onCreate={async (input) => {
            const created = await onCreate(input)
            await onResolve(reviewing.id, 'confirmed')
            showSavedToast(strings.common.saved)
            return created
          }}
        />
      )}
    </section>
  )
}
