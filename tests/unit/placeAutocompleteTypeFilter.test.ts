import { test } from 'node:test'
import assert from 'node:assert'
import { buildIncludedPrimaryTypes, FOOD_PLACE_TYPES } from '../../src/lib/placeAutocompleteTypeFilter.ts'

// Small commit (Meal plan): food-focused place autocomplete for a place-subtype Meal's
// own address field in the main Add form. PlaceAutocompleteField maps its citiesOnly/
// foodPlacesOnly booleans onto Autocomplete (New)'s `includedPrimaryTypes` through this
// pure function — tested directly here since the component itself needs a live Maps JS
// library instance to render at all.

test('neither flag set: no includedPrimaryTypes restriction at all (plain Stay/Transport/Activity address fields)', () => {
  assert.equal(buildIncludedPrimaryTypes({}), undefined)
  assert.equal(buildIncludedPrimaryTypes({ citiesOnly: false, foodPlacesOnly: false }), undefined)
})

test('foodPlacesOnly: restricts to the food/drink type set, not "restaurant" alone', () => {
  const result = buildIncludedPrimaryTypes({ foodPlacesOnly: true })
  assert.deepEqual(result, FOOD_PLACE_TYPES)
  assert.ok(result!.includes('restaurant'))
  // The whole point: a cafe/bar/bakery's own primary type isn't "restaurant" — excluding
  // them would defeat a "food places" filter for a Meal.
  assert.ok(result!.includes('cafe'))
  assert.ok(result!.includes('bar'))
  assert.ok(result!.includes('bakery'))
})

test('FOOD_PLACE_TYPES stays within Autocomplete (New)\'s 5-value max for includedPrimaryTypes', () => {
  assert.ok(FOOD_PLACE_TYPES.length <= 5, `expected at most 5 types, got ${FOOD_PLACE_TYPES.length}`)
})

test('citiesOnly takes precedence over foodPlacesOnly if somehow both were true', () => {
  assert.deepEqual(buildIncludedPrimaryTypes({ citiesOnly: true, foodPlacesOnly: true }), ['(cities)'])
})

test('citiesOnly alone: unchanged from its pre-existing behavior (vehicle rental pickup/drop-off)', () => {
  assert.deepEqual(buildIncludedPrimaryTypes({ citiesOnly: true }), ['(cities)'])
})
