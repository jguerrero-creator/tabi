import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Small commit (Meal plan, following up on item B of the Meal/restaurant-bias report):
// the main Add form's own place field (PlaceAutocompleteField, shared across every
// place-subtype type) had no food awareness at all for a place-subtype Meal — not even
// the checklist "Add place" search's restaurant bias. Fixed with a `foodPlacesOnly` prop
// (mirrors the existing `citiesOnly` prop exactly) that restricts Autocomplete (New)'s
// `includedPrimaryTypes` to a short food/drink set — NOT 'restaurant' alone, since a
// cafe/bar/bakery's own declared primary type isn't literally "restaurant" and would
// otherwise be silently excluded (see lib/placeAutocompleteTypeFilter.ts). Wired ONLY for
// a place-subtype Meal in AddReservationModal — the checklist search's own bias
// (ActivityPlaceSearchModal/typeBias) and the Stay/Transport/Activity place fields are
// untouched.
//
// Google's real Autocomplete Data wire call is a positional JSON array over
// `https://places.googleapis.com/$rpc/google.maps.places.v1.Places/AutocompletePlaces`
// (not a named-field object) — `includedPrimaryTypes` lands at index 3. Captured directly
// off the network rather than asserted indirectly, so this test fails if that index ever
// shifts (a real Google wire-format change) just as loudly as if the bias itself broke.

const FOOD_PLACE_TYPES = ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway']

function captureAutocompleteTypes(page: import('@playwright/test').Page) {
  const captured: (string[] | null)[] = []
  page.on('request', (req) => {
    if (!req.url().includes('places.googleapis.com/$rpc/google.maps.places.v1.Places/AutocompletePlaces')) return
    const body = req.postData()
    if (!body) return
    try {
      const parsed = JSON.parse(body)
      captured.push(parsed[3] ?? null)
    } catch {
      // Not the shape expected — ignore rather than fail the whole listener.
    }
  })
  return captured
}

async function createTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, name: string) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

test('switch ON: a place-subtype Meal address search carries the food types; Stay/Transport/Activity do not', async ({
  page,
  registerTrip,
}) => {
  await page.addInitScript(() => localStorage.setItem('tabi.feature.meals', '1'))
  const captured = captureAutocompleteTypes(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal food autocomplete ${runId}`)
  registerTrip(client, trip.id)

  try {
    // Opened from the Stay menu (not the Activities menu's own search-first "Add
    // activity" button — a separate, deliberately untouched coupling) so every type,
    // Activity included, can be reached through "Change type" within one modal instance.
    await page.goto(`/trips/${trip.id}/stay`)
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    // Stay (the form's default type): unrestricted, as before.
    captured.length = 0
    await page.getByLabel('Address').fill('shibuya test query a')
    await expect.poll(() => captured.length).toBeGreaterThan(0)
    expect(captured[0]).toBeNull()

    // "Change type" reveals the <select> once — it stays expanded afterward (no
    // re-click needed between the selections below).
    await page.getByRole('button', { name: 'Change type' }).click()
    const typeSelect = page.getByLabel('Type')

    await typeSelect.selectOption('transport')
    captured.length = 0
    await page.getByLabel('Departure address').fill('shibuya test query b')
    await expect.poll(() => captured.length).toBeGreaterThan(0)
    expect(captured[0]).toBeNull()

    await typeSelect.selectOption('activity')
    captured.length = 0
    await page.getByLabel('Address').fill('shibuya test query c')
    await expect.poll(() => captured.length).toBeGreaterThan(0)
    expect(captured[0]).toBeNull()

    // Meal (place subtype, the default): carries the food type set.
    await typeSelect.selectOption('meal')
    captured.length = 0
    await page.getByLabel('Address').fill('shibuya test query d')
    await expect.poll(() => captured.length).toBeGreaterThan(0)
    expect(captured[0]).toEqual(FOOD_PLACE_TYPES)
  } finally {
    await client.from('trips').delete().eq('id', trip.id)
  }
})

test('switch OFF: the Add form is unchanged — no Meal type option, and Stay\'s address field stays unrestricted', async ({
  page,
  registerTrip,
}) => {
  const captured = captureAutocompleteTypes(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal food autocomplete off ${runId}`)
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/stay`)
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    await page.getByRole('button', { name: 'Change type' }).click()
    const typeOptions = await page.getByLabel('Type').locator('option').allTextContents()
    expect(typeOptions).toEqual(['Stay', 'Transport', 'Activity'])

    captured.length = 0
    await page.getByLabel('Address').fill('shibuya test query e')
    await expect.poll(() => captured.length).toBeGreaterThan(0)
    expect(captured[0]).toBeNull()
  } finally {
    await client.from('trips').delete().eq('id', trip.id)
  }
})
