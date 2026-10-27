import { test } from 'node:test'
import assert from 'node:assert'
import { strings } from '../../src/lib/strings.ts'

// Characterization tests (Step 3b, Meal-type plan): strings.ts's reservationType,
// reservationLegLabels and menus/reservationTypeMenuLabel were converted from plain object
// literals to `satisfies Record<ReservationType, ...>` — this locks the exact label text so the
// conversion (and the `menus` split) provably didn't change a single string.

test('reservationType labels are unchanged', () => {
  assert.deepEqual(strings.reservationType, {
    stay: 'Stay',
    transport: 'Transport',
    activity: 'Activity',
  })
})

test('reservationLegLabels are unchanged', () => {
  assert.deepEqual(strings.reservationLegLabels, {
    stay: { start: 'Check-in', end: 'Check-out' },
    transport: { start: 'Departure', end: 'Arrival' },
    activity: { start: 'Start', end: 'End' },
  })
})

test('reservationTypeMenuLabel (the nav-tab wording split out of menus) is unchanged, including the plural "Activities"', () => {
  assert.deepEqual(strings.reservationTypeMenuLabel, {
    stay: 'Stay',
    transport: 'Transport',
    activity: 'Activities',
  })
})

test('menus keeps only the type-agnostic nav destinations after the split', () => {
  assert.deepEqual(strings.menus, {
    overview: 'Overview',
    budget: 'Budget',
    souvenirs: 'Souvenirs',
  })
})

test('every type-keyed table has exactly stay/transport/activity, nothing more or fewer', () => {
  assert.deepEqual(Object.keys(strings.reservationType).sort(), ['activity', 'stay', 'transport'])
  assert.deepEqual(Object.keys(strings.reservationLegLabels).sort(), ['activity', 'stay', 'transport'])
  assert.deepEqual(Object.keys(strings.reservationTypeMenuLabel).sort(), ['activity', 'stay', 'transport'])
})
