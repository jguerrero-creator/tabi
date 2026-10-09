import { useState } from 'react'
import { formatDayPillLabel } from '../../lib/datetime'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { ExtractedReservation } from '../../types/extractedReservation'
import type { NewReservation, Reservation } from '../../types/reservation'
import { AddReservationModal } from '../reservations/AddReservationModal'
import { mapExtractedReservation } from '../reservations/mapExtractedReservation'
import { extractedDateOutOfPeriod } from '../reservations/tripPeriod'
import type { PendingReservationImport } from './usePendingReservationImports'

interface PendingImportsSectionProps {
  tripId: string
  tripCurrency: string | null
  // Backlog: "Bannière From your inbox : avertir qu'une réservation reçue par email est datée
  // hors des dates du voyage" — lets each row warn before the user even opens Review, using
  // data already fetched (usePendingReservationImports' `select('*')` already includes
  // `extracted`). Null trip dates (still loading) just suppress the warning, same as a missing
  // extracted date — never an error state.
  tripStartDate: string | null
  tripEndDate: string | null
  pendingImports: PendingReservationImport[]
  onResolve: (id: string, outcome: 'confirmed' | 'dismissed') => Promise<void>
  onCreate: (input: Omit<NewReservation, 'trip_id'>) => Promise<Reservation>
}

/** "Dated Oct 28, outside this trip (Dec 26 – Jan 9)" or null — see `extractedDateOutOfPeriod`. */
function outOfPeriodWarning(
  item: PendingReservationImport,
  trip: { start_date: string | null; end_date: string | null },
): string | null {
  if (!trip.start_date || !trip.end_date) return null
  const extracted = item.extracted as unknown as ExtractedReservation
  const outOfPeriodDate = extractedDateOutOfPeriod(extracted, trip)
  if (!outOfPeriodDate) return null
  const rangeLabel = `${formatDayPillLabel(trip.start_date)} – ${formatDayPillLabel(trip.end_date)}`
  return strings.pendingImports.outOfPeriodWarning(formatDayPillLabel(outOfPeriodDate), rangeLabel)
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
  tripStartDate,
  tripEndDate,
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
        {pendingImports.map((item) => {
          const failed = item.outcome === 'failed'
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                {failed ? (
                  <p className="truncate text-sm font-medium text-slate-700">
                    {strings.pendingImports.failedMessage(item.subject)}
                  </p>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium text-slate-900">
                      {item.subject || strings.pendingImports.noSubject}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {strings.pendingImports.fromLabel(item.sender_email)}
                    </p>
                    {(() => {
                      const warning = outOfPeriodWarning(item, { start_date: tripStartDate, end_date: tripEndDate })
                      return warning ? (
                        <p className="truncate text-xs font-medium text-amber-700">{warning}</p>
                      ) : null
                    })()}
                  </>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => handleDismiss(item.id)}
                  className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  {strings.pendingImports.dismissCta}
                </button>
                {!failed && (
                  <button
                    type="button"
                    onClick={() => setReviewing(item)}
                    className="rounded-full bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800"
                  >
                    {strings.pendingImports.reviewCta}
                  </button>
                )}
              </div>
            </li>
          )
        })}
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
