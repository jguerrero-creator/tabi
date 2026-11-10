import { test } from 'node:test'
import assert from 'node:assert'
import { computeBudgetSummary } from '../../src/features/budget/computeBudgetSummary.ts'
import { computeTravelerBudgetSummary } from '../../src/features/budget/computeTravelerBudgetSummary.ts'

// Step 6 (Meal plan — the Budget). Meal joins categoryOrder (Stay/Transport/Activity/Meal),
// never divided by traveler count (isDividedByTravelerCount stays Stay-only). Also covers the
// "Other" bucket: total/pricedCount/the per-traveler base must be computed over ALL
// reservations, so a reservation type Budget hasn't caught up to yet is never silently
// dropped — it was, before this ticket (a lone priced Meal showed "Total entered so far:
// $0.00" and "0 of 1 reservations have a price entered", because `total`/`pricedCount` only
// summed `categoryOrder`-derived categories while `count` was already reservations.length).

let reservationSeq = 0
function makeReservation(type: string, priceAmount: number | null, currency = 'USD') {
  reservationSeq += 1
  return {
    id: `r${reservationSeq}`,
    trip_id: 't1',
    type,
    status: 'booked',
    name: `Reservation ${reservationSeq}`,
    price_amount: priceAmount,
    price_currency: priceAmount != null ? currency : null,
  } as unknown as Parameters<typeof computeBudgetSummary>[0][number]
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

test('a priced Meal lands in the Meals category, counts toward the total, and toward the priced counter', () => {
  const reservations = [makeReservation('stay', 100), makeReservation('meal', 40)]
  const summary = computeBudgetSummary(reservations, [], 1, 'USD', [])

  const meals = summary.categories.find((c) => c.type === 'meal')!
  assert.equal(meals.total, 40)
  assert.equal(meals.count, 1)
  assert.equal(meals.pricedCount, 1)
  assert.equal(meals.perPersonTotal, null) // never divided, unlike Stay

  assert.equal(summary.total, 140)
  assert.equal(summary.count, 2)
  assert.equal(summary.pricedCount, 2) // both priced — not "0 of 1" / "1 of 2" undercounted
})

test('a checklist Meal with no price counts toward count but not pricedCount, same as a checklist Activity', () => {
  const reservations = [makeReservation('meal', null)]
  const summary = computeBudgetSummary(reservations, [], 1, 'USD', [])

  const meals = summary.categories.find((c) => c.type === 'meal')!
  assert.equal(meals.count, 1)
  assert.equal(meals.pricedCount, 0)
  assert.equal(summary.count, 1)
  assert.equal(summary.pricedCount, 0)
})

test('the Meal total flows into every named traveler\'s flat (non-divided) base, like Transport/Activity', () => {
  const reservations = [makeReservation('stay', 200), makeReservation('meal', 60)]
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)

  const summary = computeBudgetSummary(reservations, [], 2, 'USD', [])
  const result = computeTravelerBudgetSummary(summary, [], [alice, bob], 2, 'USD')!

  const stayShare = 200 / 2 // 100, divided
  // Meal (60) is flat, entered per person already — each traveler gets the full 60,
  // not half of it, exactly like Transport/Activity.
  assert.equal(result.find((t) => t.travelerId === 'a')!.total, stayShare + 60)
  assert.equal(result.find((t) => t.travelerId === 'b')!.total, stayShare + 60)
})

test('a trip with no Meal reservations: summary is unchanged from before this ticket (the "no Meals there" guarantee)', () => {
  const reservations = [makeReservation('stay', 100), makeReservation('transport', 50), makeReservation('activity', 20)]
  const summary = computeBudgetSummary(reservations, [], 1, 'USD', [])

  const meals = summary.categories.find((c) => c.type === 'meal')!
  assert.equal(meals.count, 0)
  assert.equal(meals.total, 0)
  assert.equal(summary.other.count, 0)
  assert.equal(summary.other.total, 0)
  assert.equal(summary.total, 170)
  assert.equal(summary.count, 3)
  assert.equal(summary.pricedCount, 3)
})

test('a hypothetical type Budget has never heard of lands in "Other", never silently dropped from the total or the priced counter', () => {
  // Simulates a future ReservationType added to the DB enum before computeBudgetSummary's
  // categoryOrder is updated for it — exactly the gap that produced the original "0 of 1
  // reservations have a price entered" bug for an un-catalogued priced reservation.
  const mysteryReservation = makeReservation('excursion', 75)
  const reservations = [makeReservation('stay', 100), mysteryReservation]
  const summary = computeBudgetSummary(reservations, [], 1, 'USD', [])

  assert.equal(summary.categories.some((c) => (c.type as string) === 'excursion'), false)
  assert.equal(summary.other.count, 1)
  assert.equal(summary.other.total, 75)
  assert.equal(summary.other.pricedCount, 1)

  // The whole point: total and pricedCount cover ALL reservations, this unknown one included.
  assert.equal(summary.total, 175)
  assert.equal(summary.count, 2)
  assert.equal(summary.pricedCount, 2)
})

test('the "Other" total also flows into the per-traveler flat base — an unknown type never vanishes from a named traveler\'s share either', () => {
  const alice = makeTraveler('a', 'Alice', 0)
  const bob = makeTraveler('b', 'Bob', 1)
  const reservations = [makeReservation('stay', 200), makeReservation('excursion', 30)]

  const summary = computeBudgetSummary(reservations, [], 2, 'USD', [])
  const result = computeTravelerBudgetSummary(summary, [], [alice, bob], 2, 'USD')!

  const stayShare = 200 / 2
  assert.equal(result.find((t) => t.travelerId === 'a')!.total, stayShare + 30)
  assert.equal(result.find((t) => t.travelerId === 'b')!.total, stayShare + 30)
})
