/**
 * Autocomplete (New) accepts at most 5 `includedPrimaryTypes` values (a 6th is rejected
 * with an error) and matches a place's single declared primary type — so a "food" filter
 * can't just be `['restaurant']` alone, or an actual cafe/bar/bakery (whose own primary
 * type isn't literally "restaurant") would be silently excluded. Google's Table A food/drink
 * category has 100+ granular types (ramen_restaurant, japanese_izakaya_restaurant, etc.),
 * so this can't be exhaustive — chosen for breadth across how a "Meal" place is commonly
 * typed in Google's data: a plain restaurant, a cafe, a bar, a bakery, or a takeaway spot.
 */
export const FOOD_PLACE_TYPES = ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway']

export interface PlaceAutocompleteTypeFilterOptions {
  citiesOnly?: boolean
  foodPlacesOnly?: boolean
}

/**
 * Maps PlaceAutocompleteField's boolean props onto the `includedPrimaryTypes` request
 * field (or omits it entirely for the plain, unrestricted case). citiesOnly takes
 * precedence — the two are never both true in practice (vehicle-rental pickup/drop-off
 * vs. a place-subtype Meal are different forms), but if they ever were, city-level
 * results are the more conservative/specific restriction of the two.
 */
export function buildIncludedPrimaryTypes(
  options: PlaceAutocompleteTypeFilterOptions,
): string[] | undefined {
  if (options.citiesOnly) return ['(cities)']
  if (options.foodPlacesOnly) return FOOD_PLACE_TYPES
  return undefined
}
