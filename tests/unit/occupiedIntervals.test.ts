import { test } from 'node:test'
import assert from 'node:assert'
import { buildOccupiedClusters, pickLatestEnding } from '../../src/lib/occupiedIntervals.ts'

// Minimal occurrence shape — buildOccupiedClusters/pickLatestEnding only ever
// touch id/start_at/end_at, so fixtures here skip the rest of Reservation's
// fields rather than constructing a full one per case.
function occ(id: string, start: string, end: string | null = null) {
  return { id, start_at: start, end_at: end } as any
}

test('buildOccupiedClusters: the Nikko/lunch/next scenario merges Nikko+lunch into one cluster owned by Nikko', () => {
  const nikko = occ('nikko', '2026-08-10T01:00:00.000Z', '2026-08-10T09:00:00.000Z') // 10:00-18:00 JST
  const lunch = occ('lunch', '2026-08-10T03:30:00.000Z', '2026-08-10T05:00:00.000Z') // 12:30-14:00 JST
  const next = occ('next', '2026-08-10T10:00:00.000Z', '2026-08-10T11:00:00.000Z') // 19:00-20:00 JST

  const clusters = buildOccupiedClusters([nikko, lunch, next])

  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].owner.id, 'nikko')
  assert.equal(clusters[0].entry.id, 'nikko')
  assert.equal(clusters[0].tail.id, 'lunch')
  assert.equal(clusters[0].end, nikko.end_at)
  assert.equal(clusters[1].owner.id, 'next')
})

test('buildOccupiedClusters: two nested items — a short one fully inside a longer one', () => {
  const outer = occ('outer', '2026-01-01T09:00:00.000Z', '2026-01-01T17:00:00.000Z')
  const inner = occ('inner', '2026-01-01T10:00:00.000Z', '2026-01-01T11:00:00.000Z')

  const clusters = buildOccupiedClusters([outer, inner])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].owner.id, 'outer')
  assert.equal(clusters[0].end, outer.end_at)
})

test('buildOccupiedClusters: a chain of overlaps (A 10-12, B 11-13, C at 14) merges A+B, owned by B', () => {
  const a = occ('a', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z')
  const b = occ('b', '2026-01-01T11:00:00.000Z', '2026-01-01T13:00:00.000Z')
  const c = occ('c', '2026-01-01T14:00:00.000Z', '2026-01-01T14:00:00.000Z')

  const clusters = buildOccupiedClusters([a, b, c])

  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].owner.id, 'b') // B ends later (13:00) than A (12:00)
  assert.equal(clusters[0].end, b.end_at)
  assert.equal(clusters[1].owner.id, 'c')
})

test('buildOccupiedClusters: a point event (no end) strictly inside a longer window is swallowed, no extra cluster', () => {
  const window = occ('window', '2026-01-01T10:00:00.000Z', '2026-01-01T18:00:00.000Z')
  const point = occ('point', '2026-01-01T13:00:00.000Z', null) // end defaults to start

  const clusters = buildOccupiedClusters([window, point])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].owner.id, 'window')
  assert.equal(clusters[0].end, window.end_at)
})

test('buildOccupiedClusters: touching intervals (A ends exactly when B starts) merge into one cluster', () => {
  const a = occ('a', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z')
  const b = occ('b', '2026-01-01T12:00:00.000Z', '2026-01-01T13:00:00.000Z')

  const clusters = buildOccupiedClusters([a, b])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].owner.id, 'b') // B reaches further (13:00 > 12:00)
  assert.equal(clusters[0].end, b.end_at)
})

test('buildOccupiedClusters: identical intervals merge, tie-break keeps the later-processed one as owner', () => {
  const a = occ('a', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z')
  const b = occ('b', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z')

  const clusters = buildOccupiedClusters([a, b])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].owner.id, 'b')
  assert.equal(clusters[0].end, '2026-01-01T12:00:00.000Z')
})

test('buildOccupiedClusters: a single reservation produces a single trivial cluster', () => {
  const a = occ('a', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z')
  const clusters = buildOccupiedClusters([a])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].owner.id, 'a')
  assert.equal(clusters[0].entry.id, 'a')
  assert.equal(clusters[0].tail.id, 'a')
})

test('pickLatestEnding: picks the item whose own end is latest, not the latest-starting one', () => {
  const nikko = occ('nikko', '2026-08-10T01:00:00.000Z', '2026-08-10T09:00:00.000Z')
  const lunch = occ('lunch', '2026-08-10T03:30:00.000Z', '2026-08-10T05:00:00.000Z')
  assert.equal(pickLatestEnding([nikko, lunch]).id, 'nikko')
})

test('pickLatestEnding: ties favor the latest-starting item', () => {
  const a = occ('a', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z')
  const b = occ('b', '2026-01-01T11:00:00.000Z', '2026-01-01T12:00:00.000Z')
  assert.equal(pickLatestEnding([a, b]).id, 'b')
})

test('pickLatestEnding: a single item is trivially picked', () => {
  const a = occ('a', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z')
  assert.equal(pickLatestEnding([a]).id, 'a')
})
