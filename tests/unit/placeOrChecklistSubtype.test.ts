import { test } from 'node:test'
import assert from 'node:assert'
import {
  getPlaceOrChecklistSubtype,
  isChecklistReservation,
  isPlaceOrChecklistType,
} from '../../src/features/reservations/placeOrChecklistSubtype.ts'

// Step 4a (Meal plan): these helpers replace scattered `type === 'activity' &&
// activity_subtype === 'checklist'` checks. The core requirement: EXACTLY the same
// answer as today's inline checks for the three existing types (stay/transport/
// activity), for every combination — plus the new, previously-unreachable Meal case.

test('isPlaceOrChecklistType: true only for activity and meal', () => {
  assert.equal(isPlaceOrChecklistType('activity'), true)
  assert.equal(isPlaceOrChecklistType('meal'), true)
  assert.equal(isPlaceOrChecklistType('stay'), false)
  assert.equal(isPlaceOrChecklistType('transport'), false)
})

test('getPlaceOrChecklistSubtype: reads activity_subtype for an Activity row', () => {
  assert.equal(getPlaceOrChecklistSubtype({ type: 'activity', activity_subtype: 'place', meal_subtype: null }), 'place')
  assert.equal(
    getPlaceOrChecklistSubtype({ type: 'activity', activity_subtype: 'checklist', meal_subtype: null }),
    'checklist',
  )
})

test('getPlaceOrChecklistSubtype: reads meal_subtype for a Meal row', () => {
  assert.equal(getPlaceOrChecklistSubtype({ type: 'meal', activity_subtype: null, meal_subtype: 'place' }), 'place')
  assert.equal(
    getPlaceOrChecklistSubtype({ type: 'meal', activity_subtype: null, meal_subtype: 'checklist' }),
    'checklist',
  )
})

test('getPlaceOrChecklistSubtype: null for Stay and Transport, even if a subtype column is (incorrectly) populated', () => {
  // The DB's own CHECK constraints guarantee this never happens for real rows, but the
  // helper itself should not trust that — it reads the column that belongs to the
  // row's own `type`, never the other one.
  assert.equal(getPlaceOrChecklistSubtype({ type: 'stay', activity_subtype: 'checklist', meal_subtype: null }), null)
  assert.equal(getPlaceOrChecklistSubtype({ type: 'transport', activity_subtype: null, meal_subtype: 'checklist' }), null)
})

test('isChecklistReservation: matches today\'s inline check exactly for all three existing types, every subtype combination', () => {
  const cases: Array<{
    type: 'stay' | 'transport' | 'activity'
    activity_subtype: 'place' | 'checklist' | null
    expected: boolean
  }> = [
    { type: 'stay', activity_subtype: null, expected: false },
    { type: 'transport', activity_subtype: null, expected: false },
    { type: 'activity', activity_subtype: 'place', expected: false },
    { type: 'activity', activity_subtype: 'checklist', expected: true },
  ]
  for (const { type, activity_subtype, expected } of cases) {
    // Today's inline check, for comparison: reservation.type === 'activity' && reservation.activity_subtype === 'checklist'
    const inline = (type as string) === 'activity' && activity_subtype === 'checklist'
    assert.equal(inline, expected, `test case itself is wrong for ${type}/${activity_subtype}`)
    assert.equal(
      isChecklistReservation({ type, activity_subtype, meal_subtype: null }),
      expected,
      `isChecklistReservation diverged from the inline check for ${type}/${activity_subtype}`,
    )
  }
})

test('isChecklistReservation: true for a checklist Meal, false for a place Meal (the new case)', () => {
  assert.equal(isChecklistReservation({ type: 'meal', activity_subtype: null, meal_subtype: 'checklist' }), true)
  assert.equal(isChecklistReservation({ type: 'meal', activity_subtype: null, meal_subtype: 'place' }), false)
})
