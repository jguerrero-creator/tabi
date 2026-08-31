import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-135 — "Show tourist places" opt-in overlay on the Overview fullscreen map.
// api/places-nearby.ts imports ./_lib/rateLimit.js, which the local e2e dev server
// can't resolve (see tests/e2e/support/dev-server.mjs's comment) — stubbed via
// page.route() instead, same precedent as activity-place-search.spec.ts.

test.skip(
  !process.env.VITE_GOOGLE_MAPS_API_KEY,
  'requires VITE_GOOGLE_MAPS_API_KEY configured in .env.local to mount a real map',
)

const TOURIST_PLACE_A = {
  googlePlaceId: 'ChIJ_fixture_tourist_a',
  name: 'Shibuya Sky',
  formattedAddress: '2 Chome Shibuya, Shibuya City, Tokyo, Japan',
  lat: 35.6598,
  lng: 139.7016,
  rating: 4.6,
  userRatingsTotal: 8000,
  photoRef: null,
  category: 'tourist_attraction',
}
const TOURIST_PLACE_B = {
  googlePlaceId: 'ChIJ_fixture_tourist_b',
  name: 'Nonbei Yokocho Bar',
  formattedAddress: '1 Chome Shibuya, Shibuya City, Tokyo, Japan',
  lat: 35.6589,
  lng: 139.7002,
  rating: 4.3,
  userRatingsTotal: 500,
  photoRef: null,
  category: 'bar',
}

test('toggling "Show tourist places" queries the tourist mode and renders/clears discover markers', async ({
  page,
  registerTrip,
}) => {
  let capturedBody: Record<string, unknown> | null = null
  await page.route('**/api/places-nearby', async (route) => {
    capturedBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', results: [TOURIST_PLACE_A, TOURIST_PLACE_B] }),
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const { data: trip, error: tripError } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name: `E2E tourist places trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E tourist places reservation ${runId}`,
      start_at: '2026-09-10T06:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-09-12T02:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
      start_lat: 35.6595,
      start_lng: 139.7005,
      start_place_name: 'Shibuya Crossing',
    })
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    await page.getByRole('button', { name: 'Expand map' }).click()
    const fullscreenMap = page.locator('.fixed.inset-0.z-50')
    await expect(fullscreenMap).toBeVisible()

    // Google's attribution stays visible whether or not the overlay is on.
    const attribution = fullscreenMap.locator('.gm-style-cc, a[href*="google.com/maps"]').first()
    await expect(attribution).toBeVisible()

    const discoverMarkers = fullscreenMap.locator('span.border-sky-500')
    await expect(discoverMarkers).toHaveCount(0)

    const [request] = await Promise.all([
      page.waitForRequest('**/api/places-nearby'),
      page.getByRole('button', { name: 'Show tourist places' }).click(),
    ])
    expect(request).toBeTruthy()
    expect(capturedBody).toMatchObject({ mode: 'tourist' })

    await expect(discoverMarkers).toHaveCount(2)
    await expect(attribution).toBeVisible()

    await page.getByRole('button', { name: 'Hide tourist places' }).click()
    await expect(discoverMarkers).toHaveCount(0)
    await expect(attribution).toBeVisible()
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
