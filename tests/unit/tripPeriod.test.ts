import { test } from 'node:test'
import assert from 'node:assert'
import { extractedDateOutOfPeriod } from '../../src/features/reservations/tripPeriod.ts'

// Trip running ~26 Dec - 9 Jan, same shape as the real GetYourGuide report that
// motivated this check (Bugs DB, 2026-10-06): an activity dated well before the trip.
const trip = { start_date: '2026-12-26', end_date: '2027-01-09' }

test('extractedDateOutOfPeriod: date inside the trip range is not flagged', () => {
  assert.equal(extractedDateOutOfPeriod({ startDateTime: '2026-12-30T11:00', endDateTime: null }, trip), null)
})

test('extractedDateOutOfPeriod: date before the trip start is flagged', () => {
  assert.equal(
    extractedDateOutOfPeriod({ startDateTime: '2026-10-28T11:00', endDateTime: null }, trip),
    '2026-10-28',
  )
})

test('extractedDateOutOfPeriod: date after the trip end is flagged', () => {
  assert.equal(
    extractedDateOutOfPeriod({ startDateTime: '2027-02-01T09:00', endDateTime: null }, trip),
    '2027-02-01',
  )
})

test('extractedDateOutOfPeriod: date exactly on the trip start date is NOT flagged (inclusive bound)', () => {
  assert.equal(extractedDateOutOfPeriod({ startDateTime: '2026-12-26T08:00', endDateTime: null }, trip), null)
})

test('extractedDateOutOfPeriod: date exactly on the trip end date is NOT flagged (inclusive bound)', () => {
  assert.equal(extractedDateOutOfPeriod({ startDateTime: '2027-01-09T22:00', endDateTime: null }, trip), null)
})

test('extractedDateOutOfPeriod: end date out of range is flagged even when start is missing', () => {
  assert.equal(
    extractedDateOutOfPeriod({ startDateTime: null, endDateTime: '2027-02-01T09:00' }, trip),
    '2027-02-01',
  )
})

test('extractedDateOutOfPeriod: start takes priority when both start and end are out of range', () => {
  assert.equal(
    extractedDateOutOfPeriod(
      { startDateTime: '2026-10-28T11:00', endDateTime: '2027-02-01T09:00' },
      trip,
    ),
    '2026-10-28',
  )
})

test('extractedDateOutOfPeriod: no extracted date at all returns null', () => {
  assert.equal(extractedDateOutOfPeriod({ startDateTime: null, endDateTime: null }, trip), null)
})

test('extractedDateOutOfPeriod: missing trip dates returns null regardless of extracted date', () => {
  assert.equal(
    extractedDateOutOfPeriod(
      { startDateTime: '2026-10-28T11:00', endDateTime: null },
      { start_date: null, end_date: null },
    ),
    null,
  )
})
