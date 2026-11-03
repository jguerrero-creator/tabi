import { test } from 'node:test'
import assert from 'node:assert'
import { buildTypeSpecificColumns } from '../../src/features/reservations/reservationTypeSpecificFields.ts'

// Characterization tests (Step 3b, Meal-type plan): lock the exact subtype-column payload
// AddReservationModal's inline per-field ternaries (`option.dbType === 'stay' ? staySubtype :
// null`, etc.) produced today — a pure refactor must reproduce every one of these exactly, for
// every type, including the sibling columns that must stay null. Extended in Step 3 to cover
// the real 'meal' case (meal_subtype is now one of those siblings for every non-meal type, and
// gets its own real value for 'meal').

const baseInput = {
  staySubtype: 'hotel' as const,
  parkingIncluded: true,
  checkInDeadline: '22:00',
  transportSubtype: 'point_to_point' as const,
  transportMode: 'flight' as const,
  isPointToPoint: true,
  activitySubtype: 'place' as const,
  mealSubtype: 'place' as const,
}

test('stay: populates only the stay_* columns', () => {
  assert.deepEqual(buildTypeSpecificColumns('stay', baseInput), {
    stay_subtype: 'hotel',
    stay_parking_included: true,
    stay_check_in_deadline: '22:00',
    transport_subtype: null,
    transport_mode: null,
    activity_subtype: null,
    meal_subtype: null,
  })
})

test('stay: an empty check-in deadline string is stored as null, not the empty string', () => {
  const result = buildTypeSpecificColumns('stay', { ...baseInput, checkInDeadline: '' })
  assert.equal(result.stay_check_in_deadline, null)
})

test('transport (point-to-point): populates transport_subtype AND transport_mode', () => {
  assert.deepEqual(buildTypeSpecificColumns('transport', baseInput), {
    stay_subtype: null,
    stay_parking_included: null,
    stay_check_in_deadline: null,
    transport_subtype: 'point_to_point',
    transport_mode: 'flight',
    activity_subtype: null,
    meal_subtype: null,
  })
})

test('transport (vehicle rental): transport_mode stays null even if one was picked earlier (not a point-to-point concept)', () => {
  const result = buildTypeSpecificColumns('transport', {
    ...baseInput,
    transportSubtype: 'at_disposal',
    isPointToPoint: false,
    transportMode: 'car',
  })
  assert.equal(result.transport_subtype, 'at_disposal')
  assert.equal(result.transport_mode, null)
})

test('activity: populates only activity_subtype', () => {
  assert.deepEqual(buildTypeSpecificColumns('activity', baseInput), {
    stay_subtype: null,
    stay_parking_included: null,
    stay_check_in_deadline: null,
    transport_subtype: null,
    transport_mode: null,
    activity_subtype: 'place',
    meal_subtype: null,
  })
})

test('activity: checklist subtype flows through the same as place', () => {
  const result = buildTypeSpecificColumns('activity', { ...baseInput, activitySubtype: 'checklist' })
  assert.equal(result.activity_subtype, 'checklist')
})

// Step 3 (Meal plan): unreachable from any UI yet, but handled for real so the switch stays
// exhaustive — and specifically to prove this builder can never produce the DB-illegal
// combination (type 'meal' with meal_subtype null), since mealSubtype is a required input.
test('meal: populates only meal_subtype', () => {
  assert.deepEqual(buildTypeSpecificColumns('meal', baseInput), {
    stay_subtype: null,
    stay_parking_included: null,
    stay_check_in_deadline: null,
    transport_subtype: null,
    transport_mode: null,
    activity_subtype: null,
    meal_subtype: 'place',
  })
})

test('meal: checklist subtype flows through the same as place', () => {
  const result = buildTypeSpecificColumns('meal', { ...baseInput, mealSubtype: 'checklist' })
  assert.equal(result.meal_subtype, 'checklist')
})

test('meal: meal_subtype is never null — there is no code path that omits it for type "meal"', () => {
  // mealSubtype is a required (non-optional, non-nullable) field on the input type, so this
  // is primarily a compile-time guarantee (see reservationTypeSpecificFields.ts's own
  // comment) — this assertion just double-checks the runtime value for both real subtypes.
  for (const mealSubtype of ['place', 'checklist'] as const) {
    const result = buildTypeSpecificColumns('meal', { ...baseInput, mealSubtype })
    assert.notEqual(result.meal_subtype, null)
    assert.equal(result.meal_subtype, mealSubtype)
  }
})
