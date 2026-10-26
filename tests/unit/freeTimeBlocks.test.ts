import { test } from 'node:test'
import assert from 'node:assert'
import { computeFreeTimeBlocks, computeDayEdgeFreeBlocks } from '../../src/lib/freeTimeBlocks.ts'

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
    start_lat: null,
    start_lng: null,
    start_timezone: 'Asia/Tokyo',
    start_at: null,
    end_place_name: null,
    end_address: null,
    end_lat: null,
    end_lng: null,
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

test('computeFreeTimeBlocks: the Nikko scenario — lunch nested in a longer activity no longer produces a false 5h free block', () => {
  const nikko = makeReservation({ id: 'nikko', start_at: '2026-08-10T01:00:00.000Z', end_at: '2026-08-10T09:00:00.000Z' }) // 10:00-18:00 JST
  const lunch = makeReservation({ id: 'lunch', start_at: '2026-08-10T03:30:00.000Z', end_at: '2026-08-10T05:00:00.000Z' }) // 12:30-14:00 JST
  const next = makeReservation({ id: 'next', start_at: '2026-08-10T10:00:00.000Z', end_at: '2026-08-10T11:00:00.000Z' }) // 19:00-20:00 JST

  const blocks = computeFreeTimeBlocks([nikko, lunch, next], [])

  assert.equal(blocks.length, 1)
  const [block] = blocks
  assert.equal(block.fromReservationId, 'nikko')
  assert.equal(block.toReservationId, 'next')
  assert.equal(block.railAnchorReservationId, 'lunch')
  assert.equal(block.start, '2026-08-10T09:00:00.000Z') // 18:00 JST, Nikko's real end
  assert.equal(block.durationSeconds, 60 * 60) // 1h (18:00-19:00), not 5h
})

test('computeFreeTimeBlocks: two nested items produce no block between the outer item and the nested one', () => {
  const outer = makeReservation({ id: 'outer', start_at: '2026-01-01T09:00:00.000Z', end_at: '2026-01-01T17:00:00.000Z' })
  const inner = makeReservation({ id: 'inner', start_at: '2026-01-01T10:00:00.000Z', end_at: '2026-01-01T11:00:00.000Z' })
  const next = makeReservation({ id: 'next', start_at: '2026-01-01T18:00:00.000Z', end_at: '2026-01-01T19:00:00.000Z' })

  const blocks = computeFreeTimeBlocks([outer, inner, next], [])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].fromReservationId, 'outer')
  assert.equal(blocks[0].railAnchorReservationId, 'inner')
  assert.equal(blocks[0].start, outer.end_at)
})

test('computeFreeTimeBlocks: a chain of overlaps (A 10-12, B 11-13, C at 14) gives one 1h block owned by B', () => {
  const a = makeReservation({ id: 'a', start_at: '2026-01-01T10:00:00.000Z', end_at: '2026-01-01T12:00:00.000Z' })
  const b = makeReservation({ id: 'b', start_at: '2026-01-01T11:00:00.000Z', end_at: '2026-01-01T13:00:00.000Z' })
  const c = makeReservation({ id: 'c', start_at: '2026-01-01T14:00:00.000Z', end_at: '2026-01-01T14:00:00.000Z' })

  const blocks = computeFreeTimeBlocks([a, b, c], [])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].fromReservationId, 'b')
  assert.equal(blocks[0].toReservationId, 'c')
  assert.equal(blocks[0].durationSeconds, 60 * 60)
})

test('computeFreeTimeBlocks: a point event (no end) inside a window produces no spurious block', () => {
  const window = makeReservation({ id: 'window', start_at: '2026-01-01T10:00:00.000Z', end_at: '2026-01-01T18:00:00.000Z' })
  const point = makeReservation({ id: 'point', start_at: '2026-01-01T13:00:00.000Z', end_at: null })
  const next = makeReservation({ id: 'next', start_at: '2026-01-01T19:00:00.000Z', end_at: '2026-01-01T20:00:00.000Z' })

  const blocks = computeFreeTimeBlocks([window, point, next], [])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].fromReservationId, 'window')
  assert.equal(blocks[0].start, window.end_at)
})

test('computeFreeTimeBlocks: touching intervals produce no block between them', () => {
  const a = makeReservation({ id: 'a', start_at: '2026-01-01T10:00:00.000Z', end_at: '2026-01-01T12:00:00.000Z' })
  const b = makeReservation({ id: 'b', start_at: '2026-01-01T12:00:00.000Z', end_at: '2026-01-01T13:00:00.000Z' })
  const blocks = computeFreeTimeBlocks([a, b], [])
  assert.equal(blocks.length, 0)
})

test('computeFreeTimeBlocks: identical intervals produce no block between them', () => {
  const a = makeReservation({ id: 'a', start_at: '2026-01-01T10:00:00.000Z', end_at: '2026-01-01T12:00:00.000Z' })
  const b = makeReservation({ id: 'b', start_at: '2026-01-01T10:00:00.000Z', end_at: '2026-01-01T12:00:00.000Z' })
  const blocks = computeFreeTimeBlocks([a, b], [])
  assert.equal(blocks.length, 0)
})

test('computeFreeTimeBlocks: a single reservation produces no blocks (unchanged)', () => {
  const a = makeReservation({ id: 'a', start_at: '2026-01-01T10:00:00.000Z', end_at: '2026-01-01T12:00:00.000Z' })
  assert.equal(computeFreeTimeBlocks([a], []).length, 0)
})

test('computeFreeTimeBlocks: a cross-midnight Transport leg (same timezone) is unaffected — the arrival occurrence owns the post-arrival gap', () => {
  const transport = makeReservation({
    id: 'overnight-train',
    type: 'transport',
    transport_subtype: 'point_to_point',
    start_at: '2026-01-01T14:00:00.000Z', // 23:00 JST day 1
    start_timezone: 'Asia/Tokyo',
    end_at: '2026-01-01T16:00:00.000Z', // 01:00 JST day 2
    end_timezone: 'Asia/Tokyo',
  })
  const next = makeReservation({ id: 'next', start_at: '2026-01-01T18:00:00.000Z', end_at: '2026-01-01T19:00:00.000Z' }) // 03:00 JST day 2

  const blocks = computeFreeTimeBlocks([transport, next], [])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].fromReservationId, 'overnight-train')
  assert.equal(blocks[0].start, transport.end_at) // real arrival instant
  assert.equal(blocks[0].durationSeconds, 2 * 60 * 60)
})

test('computeFreeTimeBlocks: a cross-timezone Transport leg always splits and is unaffected by clustering', () => {
  const transport = makeReservation({
    id: 'long-haul',
    type: 'transport',
    transport_subtype: 'point_to_point',
    start_at: '2026-01-01T13:00:00.000Z',
    start_timezone: 'Asia/Tokyo',
    end_at: '2026-01-01T23:00:00.000Z',
    end_timezone: 'America/Los_Angeles', // different tz => always split, regardless of date-string coincidence
  })
  const next = makeReservation({ id: 'next', start_at: '2026-01-02T01:00:00.000Z', end_at: '2026-01-02T02:00:00.000Z' })

  const blocks = computeFreeTimeBlocks([transport, next], [])
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].fromReservationId, 'long-haul')
  assert.equal(blocks[0].start, transport.end_at)
  assert.equal(blocks[0].durationSeconds, 2 * 60 * 60)
})

test('computeFreeTimeBlocks: a multi-night Stay with a same-day Activity before checkout keeps BOTH real gaps — the Activity-to-checkout one, and checkout-to-next', () => {
  // Regression guard for a bug the clustering fix itself introduced during
  // development: a Stay check-in's `end_at` is an artificial placeholder
  // reaching to the real checkout — not a genuine continuous-occupancy span
  // like an Activity's — so it must never "swallow" a same-day Activity
  // scheduled before the real checkout the way a true enclosing Activity
  // swallows a nested Meal. Caught by
  // tests/e2e/trip-timeline-day-order-with-checkout-and-activity.spec.ts.
  const stay = makeReservation({
    id: 'stay',
    type: 'stay',
    stay_subtype: 'hotel',
    activity_subtype: null,
    start_at: '2026-01-01T06:00:00.000Z', // check-in day 1, 15:00 JST
    end_at: '2026-01-03T02:00:00.000Z', // checkout day 3, 11:00 JST
  })
  const sameDayActivity = makeReservation({
    id: 'checkout-day-activity',
    start_at: '2026-01-03T00:00:00.000Z', // checkout day 3, 09:00 JST
    end_at: '2026-01-03T01:00:00.000Z', // checkout day 3, 10:00 JST — ends 1h before the real 11:00 JST checkout
  })
  const next = makeReservation({ id: 'next', start_at: '2026-01-03T05:00:00.000Z', end_at: '2026-01-03T06:00:00.000Z' }) // day 3, 14:00 JST

  const blocks = computeFreeTimeBlocks([stay, sameDayActivity, next], [])
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].fromReservationId, 'checkout-day-activity')
  assert.equal(blocks[0].toReservationId, 'stay')
  assert.equal(blocks[0].start, sameDayActivity.end_at)
  assert.equal(blocks[0].durationSeconds, 60 * 60) // 09:00 -> 10:00 checkout
  assert.equal(blocks[1].fromReservationId, 'stay')
  assert.equal(blocks[1].toReservationId, 'next')
  assert.equal(blocks[1].start, stay.end_at)
  assert.equal(blocks[1].durationSeconds, 3 * 60 * 60) // 11:00 -> 14:00
})

test('computeFreeTimeBlocks: an Activity genuinely nested inside a multi-night Stay (not same-day as checkout) is still correctly skipped with no false gap', () => {
  const stay = makeReservation({
    id: 'stay',
    type: 'stay',
    stay_subtype: 'hotel',
    activity_subtype: null,
    start_at: '2026-01-01T06:00:00.000Z', // check-in day 1, 15:00 JST
    end_at: '2026-01-03T02:00:00.000Z', // checkout day 3, 11:00 JST
  })
  const middleDayActivity = makeReservation({
    id: 'middle-day-activity',
    start_at: '2026-01-02T01:00:00.000Z', // day 2, 10:00 JST
    end_at: '2026-01-02T03:00:00.000Z', // day 2, 12:00 JST
  })
  const next = makeReservation({ id: 'next', start_at: '2026-01-03T05:00:00.000Z', end_at: '2026-01-03T06:00:00.000Z' })

  const blocks = computeFreeTimeBlocks([stay, middleDayActivity, next], [])
  // The middle-day activity ends hours before the real checkout, so its own
  // "next cluster" is the checkout — same shape as the checkout-day case
  // above, just with a bigger (and still correct) gap.
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].fromReservationId, 'middle-day-activity')
  assert.equal(blocks[0].toReservationId, 'stay')
  assert.equal(blocks[1].fromReservationId, 'stay')
  assert.equal(blocks[1].toReservationId, 'next')
  assert.equal(blocks[1].start, stay.end_at)
})

test('computeDayEdgeFreeBlocks: the trailing edge anchors to the real last-to-finish item, not the last-by-start one', () => {
  const nikko = makeReservation({ id: 'nikko', start_at: '2026-08-10T01:00:00.000Z', end_at: '2026-08-10T09:00:00.000Z' })
  const lunch = makeReservation({ id: 'lunch', start_at: '2026-08-10T03:30:00.000Z', end_at: '2026-08-10T05:00:00.000Z' })

  const blocks = computeDayEdgeFreeBlocks(
    [{ dateKey: '2026-08-10', timezone: 'Asia/Tokyo', items: [nikko, lunch] }],
    '08:00',
    '22:00',
  )

  const trailing = blocks.find((b) => b.position === 'trailing')
  assert.ok(trailing)
  assert.equal(trailing!.start, nikko.end_at) // 18:00 JST, not lunch's 14:00
  assert.equal(trailing!.durationSeconds, 4 * 60 * 60) // 18:00-22:00
})

test('computeDayEdgeFreeBlocks: a day with one reservation is unchanged', () => {
  const item = makeReservation({ id: 'solo', start_at: '2026-01-01T01:00:00.000Z', end_at: '2026-01-01T03:00:00.000Z' }) // 10:00-12:00 JST
  const blocks = computeDayEdgeFreeBlocks(
    [{ dateKey: '2026-01-01', timezone: 'Asia/Tokyo', items: [item] }],
    '08:00',
    '22:00',
  )
  const leading = blocks.find((b) => b.position === 'leading')
  const trailing = blocks.find((b) => b.position === 'trailing')
  assert.ok(leading)
  assert.ok(trailing)
  assert.equal(trailing!.start, item.end_at)
})

test('computeDayEdgeFreeBlocks: a Stay check-in occurrence still uses its own start for the trailing edge (unchanged)', () => {
  const checkin = makeReservation({
    id: 'stay',
    type: 'stay',
    stay_subtype: 'hotel',
    activity_subtype: null,
    start_at: '2026-01-01T06:00:00.000Z', // 15:00 JST
    end_at: '2026-01-03T02:00:00.000Z', // real checkout, days later
    suppressTrailingFreeBlock: true,
  })

  const blocks = computeDayEdgeFreeBlocks(
    [{ dateKey: '2026-01-01', timezone: 'Asia/Tokyo', items: [checkin] }],
    '08:00',
    '22:00',
  )
  const trailing = blocks.find((b) => b.position === 'trailing')
  assert.ok(trailing)
  assert.equal(trailing!.start, checkin.start_at) // free right after checking in, not the real (distant) checkout
})
