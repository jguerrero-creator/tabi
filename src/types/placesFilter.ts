// Mirrors api/_lib/placesFilterExtraction.ts's PlacesFilter shape (TABI-79). Duplicated rather
// than imported — see src/types/extractedReservation.ts for why (api/ shares no tsconfig
// project reference with src/).
export interface PlacesFilter {
  matched: boolean
  clarification: string | null
  intents: { searchQuery: string; radiusMeters: number }[]
}
