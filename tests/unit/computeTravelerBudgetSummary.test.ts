import { test } from 'node:test'
import assert from 'node:assert'
import { computeBudgetSummary } from '../../src/features/budget/computeBudgetSummary.ts'
import { computeTravelerBudgetSummary } from '../../src/features/budget/computeTravelerBudgetSummary.ts'

// TABI-263 Steps C+B'. Only Stay is divided by traveler count (isDividedByTravelerCount) —
// Transport/Activity/Manual are entered per person already (decision confirmed 10/11,
// the "RENVERSEMENT DE LA PREMISSE" reversing the earlier "divide everything" premise).

let reservationSeq = 0
function makeReservation(type: string, priceAmount: number, currency = 'USD') {
  reservationSeq += 1
  return {
    id: `r${reservationSeq}`,
    trip_id: 't1',
    type,
    status: 'booked',
    name: `Reservation ${reservationSeq}`,
    price_amount: priceAmount,
    price_currency: currency,
  } as unknown as Parameters<typeof computeBudgetSummary>[0][number]
}

let souvenirSeq = 0
function makeSouvenir(amount: number | null, travelerId: string | null) {
  souvenirSeq += 1
  return {
    id: `s${souvenirSeq}`,
    trip_id: 't1',
    label: `Souvenir ${souvenirSeq}`,
    amount,
    is_checked: false,
    recipient: null,
    traveler_id: travelerId,
  } as unknown as Parameters<typeof computeTravelerBudgetSummary>[1][number]
}

function makeTraveler(id: string, name: string, position: number) {
  return {
    id,
    trip_id: 't1',
    name,
    position,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as unknown as Parameters<typeof computeTravelerBudgetSummary>[2][number]
}

function makeManualCategory(amount: number) {
  return { id: 'm1', trip_id: 't1', label: 'Food', amount, created_at: '', updated_at: '' } as unknown as Parameters<
    typeof computeBudgetSummary
  >[1][number]
}

test('worked example from the ticket: Base 210, A=233, B=223, sum = 2×Base + all souvenirs', () => {
  const reservations = [makeReservation('stay', 100), makeReservation('transport', 80), makeReservation('activity', 30)]
  const budgetCategories = [makeManualCategory(50)]
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)
  const souvenirs = [makeSouvenir(20, 'a'), makeSouvenir(10, 'b'), makeSouvenir(6, null)]

  const summary = computeBudgetSummary(reservations, budgetCategories, 2, 'USD', souvenirs)
  const result = computeTravelerBudgetSummary(summary, souvenirs, [alice, bob], 2, 'USD')

  assert.ok(result)
  const a = result!.find((t) => t.travelerId === 'a')!
  const b = result!.find((t) => t.travelerId === 'b')!
  assert.equal(a.total, 233)
  assert.equal(b.total, 223)
  assert.equal(a.total + b.total, 2 * 210 + 36)
})

test('rounding: JPY Stay 399,697 split between 2 gives 199,849 and 199,848 (largest remainder, first in list gets the odd unit)', () => {
  const reservations = [makeReservation('stay', 399_697, 'JPY')]
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)
  const souvenirs: ReturnType<typeof makeSouvenir>[] = []

  const summary = computeBudgetSummary(reservations, [], 2, 'JPY', souvenirs)
  const result = computeTravelerBudgetSummary(summary, souvenirs, [alice, bob], 2, 'JPY')!

  assert.equal(result.find((t) => t.travelerId === 'a')!.total, 199_849)
  assert.equal(result.find((t) => t.travelerId === 'b')!.total, 199_848)
})

test('rounding: EUR (2 decimals) splits to the cent and sums back exactly', () => {
  const reservations = [makeReservation('stay', 100.01, 'EUR')]
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)
  const souvenirs: ReturnType<typeof makeSouvenir>[] = []

  const summary = computeBudgetSummary(reservations, [], 2, 'EUR', souvenirs)
  const result = computeTravelerBudgetSummary(summary, souvenirs, [alice, bob], 2, 'EUR')!

  const a = result.find((t) => t.travelerId === 'a')!.total
  const b = result.find((t) => t.travelerId === 'b')!.total
  assert.equal(Math.round((a + b) * 100), Math.round(100.01 * 100))
  assert.equal(a, 50.01)
  assert.equal(b, 50)
})

test('N=3 with only 2 names: the unassigned share is divided by N, and the unnamed traveler is not shown', () => {
  const reservations = [makeReservation('stay', 300)]
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)
  const souvenirs = [makeSouvenir(30, null)] // unassigned pool of 30

  const summary = computeBudgetSummary(reservations, [], 3, 'USD', souvenirs)
  // storedTravelerCount=3, only 2 named — effectiveN = max(3, 2) = 3.
  const result = computeTravelerBudgetSummary(summary, souvenirs, [alice, bob], 3, 'USD')!

  assert.equal(result.length, 2) // the 3rd (unnamed) slot is never displayed
  const stayShare = 300 / 3 // 100, evenly
  const unassignedShare = 30 / 3 // 10, evenly
  assert.equal(result.find((t) => t.travelerId === 'a')!.total, stayShare + unassignedShare)
  assert.equal(result.find((t) => t.travelerId === 'b')!.total, stayShare + unassignedShare)
  // The visible sum (220) is deliberately less than the full pool (300 stay + 30
  // souvenirs = 330) — the invisible 3rd slot holds the rest (100 + 10 = 110).
  assert.equal(result[0].total + result[1].total, 220)
})

test('unassigned pool of zero: every souvenir assigned, no division-by-zero or stray remainder', () => {
  const reservations = [makeReservation('stay', 100)]
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)
  const souvenirs = [makeSouvenir(20, 'a'), makeSouvenir(20, 'b')]

  const summary = computeBudgetSummary(reservations, [], 2, 'USD', souvenirs)
  const result = computeTravelerBudgetSummary(summary, souvenirs, [alice, bob], 2, 'USD')!

  assert.equal(result.find((t) => t.travelerId === 'a')!.total, 50 + 20)
  assert.equal(result.find((t) => t.travelerId === 'b')!.total, 50 + 20)
})

test('a traveler deleted: their souvenirs become unassigned (DB sets traveler_id to NULL) and totals recompute — this is just N > named-count again, no special-case code', () => {
  const reservations = [makeReservation('stay', 300)]
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)
  // Carol existed, had a 30 souvenir, was deleted — ON DELETE SET NULL already ran,
  // so the souvenir's traveler_id is null by the time this is computed. Step A's
  // rule means storedTravelerCount (3) is NOT reduced by deleting a name.
  const souvenirs = [makeSouvenir(30, null)]

  const summary = computeBudgetSummary(reservations, [], 3, 'USD', souvenirs)
  const result = computeTravelerBudgetSummary(summary, souvenirs, [alice, bob], 3, 'USD')!

  assert.equal(result.length, 2)
  const stayShare = 300 / 3
  const unassignedShare = 30 / 3
  assert.equal(result.find((t) => t.travelerId === 'a')!.total, stayShare + unassignedShare)
  assert.equal(result.find((t) => t.travelerId === 'b')!.total, stayShare + unassignedShare)
})

test('no change below 2 named travelers: returns null for 0 and for 1 named traveler', () => {
  const reservations = [makeReservation('stay', 100), makeReservation('transport', 50)]
  const souvenirs = [makeSouvenir(10, null)]
  const summary = computeBudgetSummary(reservations, [], 2, 'USD', souvenirs)

  assert.equal(computeTravelerBudgetSummary(summary, souvenirs, [], 2, 'USD'), null)
  assert.equal(computeTravelerBudgetSummary(summary, souvenirs, [makeTraveler('a', 'Alice', 0)], 2, 'USD'), null)
})

test('"no change" guarantee: computeBudgetSummary itself (group total, totalPerPerson) is untouched by any of this — same formula as before TABI-263', () => {
  const reservations = [makeReservation('stay', 399_697, 'JPY'), makeReservation('transport', 208_108.82, 'JPY')]
  const summary = computeBudgetSummary(reservations, [], 2, 'JPY', [])
  // Real "Japon décembre" shape (2 travelers, no names) — group math must be
  // exactly what it was before this ticket touched anything.
  assert.equal(summary.categories.find((c) => c.type === 'stay')!.perPersonTotal, 399_697 / 2)
  assert.equal(summary.categories.find((c) => c.type === 'transport')!.perPersonTotal, null)
})
