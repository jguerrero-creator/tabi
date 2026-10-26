import { test } from 'node:test'
import assert from 'node:assert'
import { buildTripLegs, legKey } from '../../src/lib/tripLegs.ts'
import { computeFreeTimeBlocks } from '../../src/lib/freeTimeBlocks.ts'

let seq = 0
function makeReservation(overrides: Record<string, unknown> = {}) {
  seq += 1
  return {
    id: overrides.id ?? `r${seq}`,
    trip_id: 't1',
    type: 'activity',
    status: 'booked',
    name: String(overrides.id ?? `r${seq}`),
    note: null,
    price_amount: null,
    price_currency: null,
    start_place_name: null,
    start_address: null,
    start_lat: 35.0,
    start_lng: 139.0,
    start_timezone: 'Asia/Tokyo',
    start_at: null,
    end_place_name: null,
    end_address: null,
    end_lat: 35.0,
    end_lng: 139.0,
    end_timezone: 'Asia/Tokyo',
    end_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    transport_subtype: null,
    stay_subtype: null,
    stay_parking_included: null,
    stay_check_in_deadline: null,
    start_city: null,
    end_city: null,
    start_time_is_default: false,
    end_time_is_default: false,
    place_google_id: null,
    place_rating: null,
    place_user_ratings_total: null,
    place_photo_ref: null,
    place_category: null,
    confirmation_number: null,
    place_opening_hours: null,
    transport_mode: null,
    activity_subtype: 'place',
    checklist_item_count: 0,
    book_by_date: null,
    ...overrides,
  } as any
}

test('buildTripLegs: no nonsensical leg from Nikko to the nested lunch, and the real leg to Next departs from Nikko', () => {
  const nikko = makeReservation({
    id: 'nikko',
    start_at: '2026-08-10T01:00:00.000Z',
    end_at: '2026-08-10T09:00:00.000Z',
    start_lat: 36.75,
    start_lng: 139.6,
    end_lat: 36.75,
    end_lng: 139.6,
  })
  const lunch = makeReservation({
    id: 'lunch',
    start_at: '2026-08-10T03:30:00.000Z',
    end_at: '2026-08-10T05:00:00.000Z',
    start_lat: 36.76, // a different point (the restaurant), distinct from Nikko's
    start_lng: 139.61,
    end_lat: 36.76,
    end_lng: 139.61,
  })
  const next = makeReservation({
    id: 'next',
    start_at: '2026-08-10T10:00:00.000Z',
    end_at: '2026-08-10T11:00:00.000Z',
    start_lat: 36.8,
    start_lng: 139.7,
  })

  const legs = buildTripLegs([nikko, lunch, next])

  assert.equal(legs.length, 1, 'only one leg should be emitted')
  assert.equal(legs[0].fromReservationId, 'nikko')
  assert.equal(legs[0].toReservationId, 'next')
  assert.equal(legs[0].departureTime, nikko.end_at) // 18:00, not 14:00 (lunch's end)

  // Consistency: computeFreeTimeBlocks must be able to find this exact leg.
  const blocks = computeFreeTimeBlocks([nikko, lunch, next], legs)
  assert.equal(blocks.length, 1)
  assert.equal(legKey(blocks[0].fromReservationId, blocks[0].toReservationId), legKey('nikko', 'next'))
})

test('buildTripLegs: an at-disposal rental still produces individual sequential legs between its own nested stops (TABI-124, unchanged)', () => {
  const rental = makeReservation({
    id: 'rental',
    type: 'transport',
    transport_subtype: 'at_disposal',
    start_at: '2026-01-01T00:00:00.000Z', // 09:00 JST
    end_at: '2026-01-01T09:00:00.000Z', // 18:00 JST
    start_lat: 35.0,
    start_lng: 139.0,
    end_lat: 35.0,
    end_lng: 139.0,
  })
  const stop1 = makeReservation({
    id: 'stop1',
    start_at: '2026-01-01T03:00:00.000Z', // 12:00 JST
    end_at: '2026-01-01T04:00:00.000Z', // 13:00 JST
    start_lat: 35.1,
    start_lng: 139.1,
    end_lat: 35.1,
    end_lng: 139.1,
  })
  const stop2 = makeReservation({
    id: 'stop2',
    start_at: '2026-01-01T06:00:00.000Z', // 15:00 JST
    end_at: '2026-01-01T07:00:00.000Z', // 16:00 JST
    start_lat: 35.2,
    start_lng: 139.2,
  })

  const legs = buildTripLegs([rental, stop1, stop2], () => ({ lat: 35.05, lng: 139.05 }))

  assert.equal(legs.length, 2, 'rental→stop1 (covered-day anchor) and stop1→stop2 (normal point-to-point) must both survive')
  assert.equal(legs[0].fromReservationId, 'rental')
  assert.equal(legs[0].toReservationId, 'stop1')
  assert.deepEqual(legs[0].origin, { lat: 35.05, lng: 139.05 }) // the covered-day anchor, not the rental's own drop-off
  assert.equal(legs[1].fromReservationId, 'stop1')
  assert.equal(legs[1].toReservationId, 'stop2')
})

test('buildTripLegs: a multi-night Stay with a same-day Activity before checkout produces its own leg to checkout, not a false leg from check-in', () => {
  const stay = makeReservation({
    id: 'stay',
    type: 'stay',
    stay_subtype: 'hotel',
    activity_subtype: null,
    start_at: '2026-01-01T06:00:00.000Z', // check-in day 1, 15:00 JST
    end_at: '2026-01-03T02:00:00.000Z', // checkout day 3, 11:00 JST
    start_lat: 35.0,
    start_lng: 139.0,
    end_lat: 35.0,
    end_lng: 139.0,
  })
  const sameDayActivity = makeReservation({
    id: 'checkout-day-activity',
    start_at: '2026-01-03T00:00:00.000Z', // 09:00 JST
    end_at: '2026-01-03T01:00:00.000Z', // 10:00 JST — 1h before the real checkout
    start_lat: 35.1,
    start_lng: 139.1,
    end_lat: 35.1,
    end_lng: 139.1,
  })
  const next = makeReservation({
    id: 'next',
    start_at: '2026-01-03T05:00:00.000Z',
    end_at: '2026-01-03T06:00:00.000Z',
    start_lat: 35.2,
    start_lng: 139.2,
  })

  const legs = buildTripLegs([stay, sameDayActivity, next])
  assert.equal(legs.length, 2, 'the activity-to-checkout leg must survive, not collapse behind check-in')
  assert.equal(legs[0].fromReservationId, 'checkout-day-activity')
  assert.equal(legs[0].toReservationId, 'stay')
  assert.equal(legs[0].departureTime, sameDayActivity.end_at)
  assert.equal(legs[1].fromReservationId, 'stay')
  assert.equal(legs[1].toReservationId, 'next')
  assert.equal(legs[1].departureTime, stay.end_at)
})
