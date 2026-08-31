import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-49 — rich Google Places search launched from the Activities menu's Add flow.
// Both /api/places-search and /api/geocode's place-id lookup are stubbed here, same as
// extraction-review-flow.spec.ts stubs /api/extract-reservation: api/places-search.ts
// imports ./_lib/rateLimit.js, which plain Node ESM (this repo's local e2e dev server,
// not a bundler) can't resolve to the sibling .ts file, so it can't run for real
// locally — see tests/e2e/support/dev-server.mjs's comment. This exercises everything
// downstream of the real API calls: the search-first UI, prefilling the Activity form
// from a picked result, the "enter manually instead" skip path, and what actually gets
// persisted (place_* columns populated vs. null).

const FIXTURE_PLACE = {
  googlePlaceId: 'ChIJ_fixture_test_place_id',
  name: 'Tsukiji Outer Market',
  formattedAddress: '4 Chome Tsukiji, Chuo City, Tokyo, Japan',
  lat: 35.6655,
  lng: 139.7708,
  rating: 4.5,
  userRatingsTotal: 12000,
  photoRef: null,
  category: 'tourist_attraction',
}

const FIXTURE_GEOCODE_RESULT = {
  lat: FIXTURE_PLACE.lat,
  lng: FIXTURE_PLACE.lng,
  formattedAddress: FIXTURE_PLACE.formattedAddress,
  timezone: 'Asia/Tokyo',
  city: 'Tokyo',
}

async function createTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, name: string) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')

  const { data: trip, error: tripError } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  return trip
}

async function cleanupTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, tripId: string) {
  const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', tripId)
  if (deleteReservationsError) throw deleteReservationsError
  const { error: deleteTripError } = await client.from('trips').delete().eq('id', tripId)
  if (deleteTripError) throw deleteTripError
}

test('picking a rich search result prefills and saves the place metadata', async ({ page, registerTrip }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/places-search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', results: [FIXTURE_PLACE] }),
    }),
  )
  await page.route('**/api/geocode', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', result: FIXTURE_GEOCODE_RESULT }),
    }),
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E place search trip ${runId}`)
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/activities`)
    await page.getByRole('button', { name: 'Add activity' }).click()
    await expect(page.getByRole('heading', { name: 'Find a place' })).toBeVisible()

    await page.getByLabel('Search').fill('Tsukiji')
    const firstResult = page.getByRole('radio').first()
    await expect(firstResult).toBeVisible()
    await expect(firstResult).toContainText('Tsukiji Outer Market')
    await firstResult.click()

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByLabel('Name')).toHaveValue('Tsukiji Outer Market')
    await expect(page.getByLabel('Address')).toHaveValue(FIXTURE_GEOCODE_RESULT.formattedAddress)

    const [insertResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.start_lat).toBe(FIXTURE_PLACE.lat)
    expect(created.start_lng).toBe(FIXTURE_PLACE.lng)
    expect(created.place_google_id).toBe(FIXTURE_PLACE.googlePlaceId)
    expect(created.place_rating).toBe(FIXTURE_PLACE.rating)
    expect(created.place_user_ratings_total).toBe(FIXTURE_PLACE.userRatingsTotal)
    expect(created.place_category).toBe(FIXTURE_PLACE.category)
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

// TABI-51 — "Local gems" filter: rating >= 4.6 AND review count < 200, applied client-side
// to results already returned by /api/places-search (no extra API calls/fields).
const LOCAL_GEM_PLACE = {
  googlePlaceId: 'ChIJ_fixture_local_gem',
  name: 'Tiny Ramen Counter',
  formattedAddress: '2 Chome Yanaka, Taito City, Tokyo, Japan',
  lat: 35.7272,
  lng: 139.7674,
  rating: 4.8,
  userRatingsTotal: 42,
  photoRef: null,
  category: 'restaurant',
}
const TOURISTY_PLACE = {
  googlePlaceId: 'ChIJ_fixture_touristy',
  name: 'Famous Landmark Cafe',
  formattedAddress: '1 Chome Marunouchi, Chiyoda City, Tokyo, Japan',
  lat: 35.6812,
  lng: 139.7671,
  rating: 4.5,
  userRatingsTotal: 15000,
  photoRef: null,
  category: 'cafe',
}

test('the Local gems filter shows only high-rating/low-review results', async ({ page, registerTrip }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/places-search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', results: [LOCAL_GEM_PLACE, TOURISTY_PLACE] }),
    }),
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E local gems filter trip ${runId}`)
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/activities`)
    await page.getByRole('button', { name: 'Add activity' }).click()
    await expect(page.getByRole('heading', { name: 'Find a place' })).toBeVisible()

    await page.getByLabel('Search').fill('Tokyo')
    await expect(page.getByRole('radio')).toHaveCount(2)
    await expect(page.getByRole('radio', { name: /Tiny Ramen Counter/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Famous Landmark Cafe/ })).toBeVisible()

    await page.getByRole('button', { name: '💎 Local gems' }).click()
    await expect(page.getByRole('radio')).toHaveCount(1)
    await expect(page.getByRole('radio', { name: /Tiny Ramen Counter/ })).toBeVisible()
    await expect(page.getByRole('radio', { name: /Famous Landmark Cafe/ })).toHaveCount(0)

    // Toggling off restores both results.
    await page.getByRole('button', { name: '💎 Local gems' }).click()
    await expect(page.getByRole('radio')).toHaveCount(2)
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('skipping search still saves a normal activity with no place metadata', async ({ page, registerTrip }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E place search skip trip ${runId}`)
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/activities`)
    await page.getByRole('button', { name: 'Add activity' }).click()
    await expect(page.getByRole('heading', { name: 'Find a place' })).toBeVisible()

    await page.getByRole('button', { name: 'Enter manually instead' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const reservationName = `E2E manual activity ${runId}`
    await page.getByLabel('Name').fill(reservationName)

    const [insertResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.place_google_id).toBeNull()
    expect(created.place_rating).toBeNull()
    expect(created.place_photo_ref).toBeNull()
  } finally {
    await cleanupTrip(client, trip.id)
  }
})
