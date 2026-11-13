import { test } from 'node:test'
import assert from 'node:assert'
import { renderRecapEmail } from '../../api/_lib/recapEmail.ts'
import type { RecapContent } from '../../api/_lib/recapContent.ts'
import type { DayOccurrence } from '../../src/lib/dayOccurrences.ts'

// Meal-type opening checklist, item 5: the recap email (TABI-36) only ever labels a
// row via `strings.reservationType[item.type]` (api/_lib/recapEmail.ts:59) — already
// generalized in Step 3 — and `buildRows` is a flat forEach over `content.items`, with
// no grouping or filtering by type anywhere that could silently drop a Meal row. This
// renders the real function (no email sent, renderRecapEmail is pure — no network
// call exists to make) and asserts the label reads "Meal", not "undefined" or blank.

function makeMealOccurrence(overrides: Partial<DayOccurrence> = {}): DayOccurrence {
  return {
    id: 'r1',
    trip_id: 't1',
    type: 'meal',
    status: 'booked',
    name: 'Sushi Dai',
    start_at: '2026-09-12T03:00:00.000Z',
    start_timezone: 'Asia/Tokyo',
    end_at: '2026-09-12T04:00:00.000Z',
    end_timezone: 'Asia/Tokyo',
    ...overrides,
  } as unknown as DayOccurrence
}

test('recap email: a Meal reservation renders its row labeled "Meal", not dropped or "undefined"', () => {
  const content: RecapContent = {
    tripName: 'Japon décembre',
    dateKey: '2026-09-12',
    timezone: 'Asia/Tokyo',
    items: [makeMealOccurrence()],
    freeBlocks: [],
    dayEdges: [],
  }

  const { html } = renderRecapEmail(content)

  assert.match(html, /Meal · Sushi Dai/)
  assert.doesNotMatch(html, /undefined/)
})

test('recap email: a Meal is not dropped when mixed with other reservation types (no grouping/filtering by type)', () => {
  const stayOccurrence = makeMealOccurrence({
    id: 'r2',
    type: 'stay',
    name: 'Park Hyatt',
    start_at: '2026-09-12T00:00:00.000Z',
  })
  const mealOccurrence = makeMealOccurrence({
    id: 'r3',
    name: 'Ramen lunch',
    start_at: '2026-09-12T05:00:00.000Z',
  })
  const content: RecapContent = {
    tripName: 'Japon décembre',
    dateKey: '2026-09-12',
    timezone: 'Asia/Tokyo',
    items: [stayOccurrence, mealOccurrence],
    freeBlocks: [],
    dayEdges: [],
  }

  const { html } = renderRecapEmail(content)

  assert.match(html, /Stay · Park Hyatt/)
  assert.match(html, /Meal · Ramen lunch/)
})
