import { test } from 'node:test'
import assert from 'node:assert'
import { fieldRequirementsByType } from '../../src/features/reservations/reservationFieldRequirements.ts'

// Characterization tests (Step 3b, Meal-type plan): lock the exact field-requirement values
// AddReservationModal's inline `mainType !== 'activity'`/`isPointToPoint`/etc. derivation
// produced today, BEFORE it was extracted into this exhaustive Record<ReservationType, ...>
// table — a pure refactor must reproduce every one of these exactly.

test('stay: requires start+end, no end address, overlap checked', () => {
  const req = fieldRequirementsByType.stay({ transportSubtype: 'point_to_point' })
  assert.deepEqual(req, {
    requiresStart: true,
    requiresStartTime: false,
    requiresEnd: true,
    requiresEndTime: false,
    requiresEndAddress: false,
    checksOverlap: true,
  })
})

test('transport (point-to-point): requires start+end, end time AND end address, overlap checked', () => {
  const req = fieldRequirementsByType.transport({ transportSubtype: 'point_to_point' })
  assert.deepEqual(req, {
    requiresStart: true,
    requiresStartTime: false,
    requiresEnd: true,
    requiresEndTime: true,
    requiresEndAddress: true,
    checksOverlap: true,
  })
})

test('transport (vehicle rental / at_disposal): requires end address but NOT end time, overlap checked', () => {
  const req = fieldRequirementsByType.transport({ transportSubtype: 'at_disposal' })
  assert.deepEqual(req, {
    requiresStart: true,
    requiresStartTime: false,
    requiresEnd: true,
    requiresEndTime: false,
    requiresEndAddress: true,
    checksOverlap: true,
  })
})

test('activity: requires neither start nor end, no end address, overlap NOT checked', () => {
  const req = fieldRequirementsByType.activity({ transportSubtype: 'point_to_point' })
  assert.deepEqual(req, {
    requiresStart: false,
    requiresStartTime: false,
    requiresEnd: false,
    requiresEndTime: false,
    requiresEndAddress: false,
    checksOverlap: false,
  })
})

test('requiresStartTime is false for every type today (no type hard-requires a start time)', () => {
  assert.equal(fieldRequirementsByType.stay({ transportSubtype: 'point_to_point' }).requiresStartTime, false)
  assert.equal(fieldRequirementsByType.transport({ transportSubtype: 'point_to_point' }).requiresStartTime, false)
  assert.equal(fieldRequirementsByType.transport({ transportSubtype: 'at_disposal' }).requiresStartTime, false)
  assert.equal(fieldRequirementsByType.activity({ transportSubtype: 'point_to_point' }).requiresStartTime, false)
})

test('the table has exactly the three types defined today (stay, transport, activity)', () => {
  assert.deepEqual(Object.keys(fieldRequirementsByType).sort(), ['activity', 'stay', 'transport'])
})
