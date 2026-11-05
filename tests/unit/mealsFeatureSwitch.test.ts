import { test } from 'node:test'
import assert from 'node:assert'
import { isMealsEnabled } from '../../src/lib/mealsFeatureSwitch.ts'

// Step 4a (Meal plan): the feature switch nothing reads yet. This Node test environment
// has no real `localStorage` global at all — confirmed (`typeof localStorage ===
// 'undefined'`) — which already exercises the "storage unavailable" path for free; the
// other cases install a minimal mock on globalThis for the duration of one test.

function withMockLocalStorage<T>(mock: Pick<Storage, 'getItem'> | 'throw', fn: () => T): T {
  const original = (globalThis as { localStorage?: unknown }).localStorage
  ;(globalThis as { localStorage?: unknown }).localStorage =
    mock === 'throw'
      ? {
          getItem() {
            throw new Error('storage blocked (simulated)')
          },
        }
      : mock
  try {
    return fn()
  } finally {
    ;(globalThis as { localStorage?: unknown }).localStorage = original
  }
}

test('isMealsEnabled: false when localStorage does not exist at all (this test environment)', () => {
  assert.equal(typeof (globalThis as { localStorage?: unknown }).localStorage, 'undefined')
  assert.equal(isMealsEnabled(), false)
})

test('isMealsEnabled: true when the flag is exactly "1"', () => {
  const result = withMockLocalStorage({ getItem: (key) => (key === 'tabi.feature.meals' ? '1' : null) } as Storage, () =>
    isMealsEnabled(),
  )
  assert.equal(result, true)
})

test('isMealsEnabled: false when the key is absent', () => {
  const result = withMockLocalStorage({ getItem: () => null } as Storage, () => isMealsEnabled())
  assert.equal(result, false)
})

test('isMealsEnabled: false for any value other than the exact string "1"', () => {
  for (const value of ['true', '0', 'yes', '1 ', '']) {
    const result = withMockLocalStorage({ getItem: () => value } as Storage, () => isMealsEnabled())
    assert.equal(result, false, `expected false for value ${JSON.stringify(value)}`)
  }
})

test('isMealsEnabled: false (not a throw) when localStorage access itself throws (blocked storage)', () => {
  const result = withMockLocalStorage('throw', () => isMealsEnabled())
  assert.equal(result, false)
})
