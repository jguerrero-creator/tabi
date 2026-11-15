import { test } from 'node:test'
import assert from 'node:assert'
import { resolveDefaultAddressForDay } from '../../src/features/reservations/resolveDefaultAddressForDay.ts'
import type { TripDayLocation } from '../../src/types/dayLocation.ts'

// TABI-267 — "Formulaire d'ajout : adresse par defaut = lieu de la journee". Precedence:
// 1) the day's own explicit planned location, 2) the accommodation active that night,
// 3) the TABI-204 trip-wide fallback (last known trip location), 4) null.

let seq = 0
function makeReservation(overrides: Record<string, unknown> = {}) {
  seq += 1
  return {
    id: overrides.id ?? `r${seq}`,
    trip_id: 't1',
    type: 'stay',
    status: 'booked',
    name: String(overrides.id ?? `r${seq}`),
    start_place_name: null,
    start_address: null,
    start_lat: null,
    start_lng: null,
    start_timezone: null,
    start_at: null,
    end_place_name: null,
    end_address: null,
    end_lat: null,
    end_lng: null,
    end_timezone: null,
    end_at: null,
    start_city: null,
    end_city: null,
    ...overrides,
  } as any
}

function makeDayLocation(dateKey: string, overrides: Record<string, unknown> = {}): TripDayLocation {
  return {
    trip_id: 't1',
    date: dateKey,
    place_name: 'Day Location',
    address: 'Day Location Address',
    lat: 1,
    lng: 1,
    city: 'Day City',
    timezone: 'UTC',
    ...overrides,
  } as TripDayLocation
}

function daysMap(...entries: TripDayLocation[]): Map<string, TripDayLocation> {
  return new Map(entries.map((entry) => [entry.date, entry]))
}

test('day-planned location wins over the accommodation active that same night', () => {
  const stay = makeReservation({
    type: 'stay',
    start_at: '2026-09-10T00:00:00.000Z',
    start_timezone: 'Asia/Tokyo',
    end_at: '2026-09-20T00:00:00.000Z',
    end_timezone: 'Asia/Tokyo',
    start_address: 'Hotel Kyoto',
    start_place_name: 'Hotel Kyoto',
    start_lat: 35.0,
    start_lng: 135.7,
    start_city: 'Kyoto',
  })
  const dayLocations = daysMap(makeDayLocation('2026-09-15', { address: 'Osaka, Japan', city: 'Osaka' }))

  const result = resolveDefaultAddressForDay('2026-09-15', [stay], dayLocations)
  assert.equal(result?.formattedAddress, 'Osaka, Japan')
  assert.equal(result?.source, 'day_location')
})

test('falls back to the active accommodation when the day has no explicit planned location', () => {
  const stay = makeReservation({
    type: 'stay',
    start_at: '2026-09-10T00:00:00.000Z',
    start_timezone: 'Asia/Tokyo',
    end_at: '2026-09-20T00:00:00.000Z',
    end_timezone: 'Asia/Tokyo',
    start_address: 'Hotel Kyoto',
    start_place_name: 'Hotel Kyoto',
    start_lat: 35.0,
    start_lng: 135.7,
    start_city: 'Kyoto',
  })

  const result = resolveDefaultAddressForDay('2026-09-15', [stay], new Map())
  assert.equal(result?.formattedAddress, 'Hotel Kyoto')
  assert.equal(result?.source, 'accommodation')
})

test('on the check-in day, the stay just starting counts as active', () => {
  const stay = makeReservation({
    type: 'stay',
    start_at: '2026-09-10T00:00:00.000Z',
    start_timezone: 'UTC',
    end_at: '2026-09-15T00:00:00.000Z',
    end_timezone: 'UTC',
    start_address: 'Hotel Kyoto',
    start_lat: 35.0,
    start_lng: 135.7,
  })

  const result = resolveDefaultAddressForDay('2026-09-10', [stay], new Map())
  assert.equal(result?.source, 'accommodation')
})

test('on the check-out day, that stay no longer counts as active (a same-day changeover, not covered), so step 2 is skipped', () => {
  const stay = makeReservation({
    type: 'stay',
    start_at: '2026-09-10T00:00:00.000Z',
    start_timezone: 'UTC',
    end_at: '2026-09-15T00:00:00.000Z',
    end_timezone: 'UTC',
    start_address: 'Hotel Kyoto',
    start_lat: 35.0,
    start_lng: 135.7,
  })

  // No day-location and no active stay on the checkout day itself — step 2 (accommodation)
  // finds nothing for THIS day, so it falls through to step 3, the trip-wide fallback. In
  // this single-reservation trip that fallback happens to resolve to the same stay's own
  // address (via its check-in instant) — a 'reservation' source, not an 'accommodation' one,
  // proving the day-scoped "active on this date" check was really bypassed, not coincidentally hit.
  const result = resolveDefaultAddressForDay('2026-09-15', [stay], new Map())
  assert.equal(result?.formattedAddress, 'Hotel Kyoto')
  assert.equal(result?.source, 'reservation')
})

test('a transit day with no stay at all falls through to the trip-wide TABI-204 fallback', () => {
  const earlierFlight = makeReservation({
    type: 'transport',
    start_at: '2026-09-09T01:00:00.000Z',
    start_timezone: 'UTC',
    end_at: '2026-09-09T04:00:00.000Z',
    end_timezone: 'UTC',
    end_address: 'Narita Airport',
    end_lat: 35.7,
    end_lng: 140.3,
  })

  const result = resolveDefaultAddressForDay('2026-09-12', [earlierFlight], new Map())
  assert.equal(result?.formattedAddress, 'Narita Airport')
  assert.equal(result?.source, 'reservation')
})

test('nothing known anywhere in the trip resolves to null (caller leaves the field empty)', () => {
  const result = resolveDefaultAddressForDay('2026-09-12', [], new Map())
  assert.equal(result, null)
})

test('no date known yet (opened from a type menu) skips straight to the trip-wide fallback', () => {
  const stay = makeReservation({
    type: 'stay',
    start_at: '2026-09-10T00:00:00.000Z',
    start_timezone: 'UTC',
    end_at: '2026-09-20T00:00:00.000Z',
    end_timezone: 'UTC',
    start_address: 'Hotel Kyoto',
    start_lat: 35.0,
    start_lng: 135.7,
  })
  const dayLocations = daysMap(makeDayLocation('2026-09-15', { address: 'Osaka, Japan' }))

  // Even though a day-location exists in the trip, with no dateKey there's no "this day"
  // to prefer it for — same trip-wide answer lastKnownTripLocation would give directly.
  const result = resolveDefaultAddressForDay(null, [stay], dayLocations)
  assert.equal(result?.formattedAddress, 'Osaka, Japan')
  assert.equal(result?.source, 'day_location')
})

test('an active accommodation in one timezone resolves correctly against a dateKey (local calendar date, not UTC)', () => {
  // Check-in 2026-09-09T20:00Z = 2026-09-10 05:00 JST local — the stay is active on the
  // *local* date 2026-09-10, not the UTC date 2026-09-09.
  const stay = makeReservation({
    type: 'stay',
    start_at: '2026-09-09T20:00:00.000Z',
    start_timezone: 'Asia/Tokyo',
    end_at: '2026-09-15T00:00:00.000Z',
    end_timezone: 'Asia/Tokyo',
    start_address: 'Hotel Tokyo',
    start_lat: 35.6,
    start_lng: 139.6,
  })

  // The day before check-in: step 2 finds no active stay for 2026-09-09, so it falls
  // through to step 3's trip-wide fallback — which, same as above, happens to resolve to
  // this same stay's own address but tagged 'reservation', not 'accommodation'.
  const dayBefore = resolveDefaultAddressForDay('2026-09-09', [stay], new Map())
  assert.equal(dayBefore?.formattedAddress, 'Hotel Tokyo')
  assert.equal(dayBefore?.source, 'reservation')

  const checkInDay = resolveDefaultAddressForDay('2026-09-10', [stay], new Map())
  assert.equal(checkInDay?.formattedAddress, 'Hotel Tokyo')
  assert.equal(checkInDay?.source, 'accommodation')
})
