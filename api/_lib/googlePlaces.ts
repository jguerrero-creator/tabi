// Shared Places API (New) response schema/mapping — used by both places-search.ts
// (Text Search) and places-nearby.ts (Nearby Search, TABI-24), which return the
// same `places[]` shape at the same field mask. Keeping one validated mapping
// avoids the two endpoints drifting out of sync on what counts as a valid place.
import { z } from 'zod'

export interface PlaceSearchResult {
  googlePlaceId: string
  name: string
  formattedAddress: string
  lat: number
  lng: number
  rating: number | null
  userRatingsTotal: number | null
  photoRef: string | null
  category: string | null
}

// Validated before mapping — Google's response is external data, never trusted blindly.
const GooglePlaceSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  rating: z.number().nullable().optional(),
  userRatingCount: z.number().nullable().optional(),
  photos: z.array(z.object({ name: z.string() })).optional(),
  primaryType: z.string().nullable().optional(),
})

export const GoogleSearchResponseSchema = z.object({ places: z.array(GooglePlaceSchema).optional() })

export const PLACE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.photos',
  'places.primaryType',
].join(',')

// TABI-89: Place Details response shape for regular opening hours — Text/Nearby
// Search never return this field, so a dedicated Place Details call is needed.
// `day` is 0=Sunday..6=Saturday, same convention as JS `Date.getDay()`.
const OpeningHoursTimeSchema = z.object({ day: z.number(), hour: z.number(), minute: z.number() })

export const RegularOpeningHoursSchema = z.object({
  periods: z.array(
    z.object({
      open: OpeningHoursTimeSchema,
      close: OpeningHoursTimeSchema.optional(),
    }),
  ),
})

export type RegularOpeningHours = z.infer<typeof RegularOpeningHoursSchema>

export const GooglePlaceDetailsSchema = z.object({
  id: z.string(),
  regularOpeningHours: RegularOpeningHoursSchema.optional(),
})

export const PLACE_DETAILS_OPENING_HOURS_FIELD_MASK = 'id,regularOpeningHours'

export function mapGooglePlaces(
  places: z.infer<typeof GoogleSearchResponseSchema>['places'],
  fallbackName: string,
): PlaceSearchResult[] {
  return (places ?? [])
    .filter((place) => place.location)
    .map((place) => ({
      googlePlaceId: place.id,
      name: place.displayName?.text ?? fallbackName,
      formattedAddress: place.formattedAddress ?? '',
      lat: place.location!.latitude,
      lng: place.location!.longitude,
      rating: place.rating ?? null,
      userRatingsTotal: place.userRatingCount ?? null,
      photoRef: place.photos?.[0]?.name ?? null,
      category: place.primaryType ?? null,
    }))
}
