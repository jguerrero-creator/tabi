import type { ExtractedReservation } from '../../types/extractedReservation'
import type { ReservationType, StaySubtype, TransportSubtype } from '../../types/reservation'

export interface ExtractedReservationPrefill {
  defaultType: ReservationType
  requireTypeChoice: boolean
  defaultStaySubtype: StaySubtype
  defaultTransportSubtype: TransportSubtype
  initialName: string | null
  initialStartAddressText: string | null
  initialEndAddressText: string | null
  initialStartDate: string | null
  initialStartTime: string | null
  initialEndDate: string | null
  initialEndTime: string | null
  initialPriceAmount: number | null
  initialConfirmationNumber: string | null
  initialNote: string | null
}

// TABI-12: maps the LLM's best-effort extraction onto the shared Add sheet's prefill props,
// so the user reviews/corrects the same form used for manual entry rather than a one-off screen.
export function mapExtractedReservation(
  extracted: ExtractedReservation,
  tripCurrency: string | null,
): ExtractedReservationPrefill {
  const start = splitNaiveIsoDateTime(extracted.startDateTime)
  const end = splitNaiveIsoDateTime(extracted.endDateTime)

  // Currency is always inherited from the trip, never per-reservation (TABI-16). If the
  // extracted price is in a different currency, don't silently relabel it as the trip's —
  // surface the original figure as a note for the user to reconcile by hand instead.
  const priceMatchesTripCurrency = extracted.price !== null && (!tripCurrency || extracted.price.currency === tripCurrency)

  const noteLines: string[] = []
  if (extracted.price && !priceMatchesTripCurrency) {
    noteLines.push(`Extracted price: ${extracted.price.amount} ${extracted.price.currency}`)
  }

  return {
    defaultType: extracted.type ?? 'stay',
    requireTypeChoice: extracted.type === null,
    defaultStaySubtype: extracted.staySubtype ?? 'hotel',
    defaultTransportSubtype: extracted.transportSubtype ?? 'point_to_point',
    initialName: extracted.name,
    initialStartAddressText: extracted.startAddress,
    initialEndAddressText: extracted.endAddress,
    initialStartDate: start?.date ?? null,
    initialStartTime: start?.time ?? null,
    initialEndDate: end?.date ?? null,
    initialEndTime: end?.time ?? null,
    initialPriceAmount: priceMatchesTripCurrency ? (extracted.price?.amount ?? null) : null,
    initialConfirmationNumber: extracted.confirmationNumber,
    initialNote: noteLines.length > 0 ? noteLines.join('\n') : null,
  }
}

// Deliberately never routed through `new Date(...)`: an offset-less ISO string would be
// silently reinterpreted in the browser's own timezone. The extraction has no reliable
// timezone of its own — read the date/time digits as printed and let the Add sheet's normal
// submit-time geocoding resolve the real timezone from the address, exactly as if a person had
// typed these fields in by hand from the confirmation.
function splitNaiveIsoDateTime(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return match ? { date: match[1], time: match[2] } : null
}
