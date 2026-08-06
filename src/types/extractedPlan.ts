import type { ExtractedReservation } from './extractedReservation'

// Mirrors api/_lib/extraction.ts's ExtractedPlanSchema/PlanItemSchema (TABI-208). Duplicated
// rather than imported for the same reason as extractedReservation.ts: api/ isn't covered by any
// tsconfig project reference shared with src/.
export type PlanItem =
  | { kind: 'dayLocation'; date: string; placeName: string }
  | { kind: 'reservation'; reservation: ExtractedReservation }

export interface ExtractedPlan {
  items: PlanItem[]
}
