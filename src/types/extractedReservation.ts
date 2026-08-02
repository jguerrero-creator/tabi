import type { ReservationType, StaySubtype, TransportSubtype } from './reservation'

// Mirrors api/extract-reservation.ts's response shape (TABI-8). Duplicated rather than
// imported: api/ isn't covered by any tsconfig project reference shared with src/, so there's
// no shared-types path between the two today.
export interface ExtractedReservation {
  type: ReservationType | null
  staySubtype: StaySubtype | null
  transportSubtype: TransportSubtype | null
  name: string | null
  startAddress: string | null
  endAddress: string | null
  startDateTime: string | null
  endDateTime: string | null
  confirmationNumber: string | null
  price: { amount: number; currency: string } | null
}
