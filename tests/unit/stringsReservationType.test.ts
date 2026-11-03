import { test } from 'node:test'
import assert from 'node:assert'
import { strings } from '../../src/lib/strings.ts'

// Characterization tests (Step 3b, Meal-type plan): strings.ts's reservationType,
// reservationLegLabels and menus/reservationTypeMenuLabel were converted from plain object
// literals to `satisfies Record<ReservationType, ...>` — this locks the exact label text so the
// conversion (and the `menus` split) provably didn't change a single string.

test('reservationType labels are unchanged, plus the new Meal entry (Step 3)', () => {
  assert.deepEqual(strings.reservationType, {
    stay: 'Stay',
    transport: 'Transport',
    activity: 'Activity',
    meal: 'Meal',
  })
})

test('reservationLegLabels are unchanged, plus Meal using the same wording as Activity', () => {
  assert.deepEqual(strings.reservationLegLabels, {
    stay: { start: 'Check-in', end: 'Check-out' },
    transport: { start: 'Departure', end: 'Arrival' },
    activity: { start: 'Start', end: 'End' },
    meal: { start: 'Start', end: 'End' },
  })
})

test('reservationTypeMenuLabel (the nav-tab wording split out of menus) is unchanged, including the plural "Activities"/"Meals"', () => {
  assert.deepEqual(strings.reservationTypeMenuLabel, {
    stay: 'Stay',
    transport: 'Transport',
    activity: 'Activities',
    meal: 'Meals',
  })
})

test('menus keeps only the type-agnostic nav destinations after the split', () => {
  assert.deepEqual(strings.menus, {
    overview: 'Overview',
    budget: 'Budget',
    souvenirs: 'Souvenirs',
  })
})

test('every type-keyed table has exactly stay/transport/activity/meal, nothing more or fewer', () => {
  assert.deepEqual(Object.keys(strings.reservationType).sort(), ['activity', 'meal', 'stay', 'transport'])
  assert.deepEqual(Object.keys(strings.reservationLegLabels).sort(), ['activity', 'meal', 'stay', 'transport'])
  assert.deepEqual(Object.keys(strings.reservationTypeMenuLabel).sort(), ['activity', 'meal', 'stay', 'transport'])
})
