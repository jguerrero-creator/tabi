import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Follow-up to overview-map-bounds-far-apart.spec.ts: that suite only ever navigates to
// the trip via a fresh page.goto(), so it can't catch a regression that only shows up on
// remount. reuseMaps (added same day as this test, to stop WebGL context exhaustion from
// piling up un-torn-down map instances) pools google.maps.Map instances by mapId and
// reattaches the cached instance's DOM node instead of creating a fresh one. This test
// leaves the Overview screen (a real route change that unmounts OverviewScreen/MiniMap,
// not the Planning toggle-state which stays mounted) and returns to it repeatedly,
// checking that pointsForCamera's home-exclusion still holds on every return visit, not
// just the first mount.

function reservation(tripId: string, name: string, lat: number, lng: number, startAt: string, endAt: string) {
  return {
    trip_id: tripId,
    type: 'stay',
    stay_subtype: 'hotel',
    status: 'booked',
    name: `reframe-${name}`,
    start_at: startAt,
    start_timezone: 'UTC',
    end_at: endAt,
    end_timezone: 'UTC',
    start_lat: lat,
    start_lng: lng,
    start_place_name: name,
  }
}

test('Overview map keeps framing only the post-flight destination after leaving and returning to Overview', async ({
  page,
  registerTrip,
}) => {
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
    .insert({ organizer_id: user.id, name: `E2E reframe trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert([
      reservation(trip.id, 'Tokyo', 35.6762, 139.6503, '2026-09-10T06:00:00.000Z', '2026-09-12T06:00:00.000Z'),
      reservation(trip.id, 'Brussels', 50.8503, 4.3517, '2026-09-15T06:00:00.000Z', '2026-09-17T06:00:00.000Z'),
    ])
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    const overviewMap = page.getByTestId('map').first()

    async function expectCorrectFraming(cycle: string) {
      await expect(overviewMap, `${cycle}: map should be visible`).toBeVisible()
      await expect(overviewMap.getByTitle('Brussels'), `${cycle}: Brussels (destination) should be framed`).toBeVisible()
      await expect(
        overviewMap.getByTitle('Tokyo'),
        `${cycle}: Tokyo (pre-flight home) should stay outside the framed viewport`,
      ).not.toBeVisible()
    }

    // First mount — this path is already covered by overview-map-bounds-far-apart.spec.ts,
    // asserted again here only as the baseline for the remounts below.
    await expectCorrectFraming('first load')

    // Leave Overview via a real route change (unmounts OverviewScreen/MiniMap entirely,
    // unlike the Planning toggle which is a query-param state on the same route) and
    // return, three times, to check the framing isn't a first-mount-only fluke.
    for (let i = 1; i <= 3; i++) {
      await page.getByRole('link', { name: 'Budget', exact: true }).click()
      await expect(page.getByTestId('map')).toHaveCount(0)

      await page.getByRole('link', { name: 'Overview', exact: true }).first().click()
      await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

      await expectCorrectFraming(`return visit ${i}`)
    }
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

// The small preview MiniMap and the fullscreen OverviewMap both render a vis.gl <Map>
// with the same mapId and no renderingType/colorScheme override, so reuseMaps pools them
// under the *same* cache key (see use-map-instance.ts's CachedMapStack, keyed only by
// `${mapId}:${renderingType}:${colorScheme}`). Opening/closing fullscreen interleaves a
// second, differently-configured (zoom 11 vs 14, wider padding) Map instance into that
// same shared stack before leaving and returning to Overview, to check the preview
// doesn't end up reusing the fullscreen instance's stale camera (or vice versa).
test('Overview map keeps correct framing after fullscreen is opened/closed, then Overview is left and returned to', async ({
  page,
  registerTrip,
}) => {
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
    .insert({ organizer_id: user.id, name: `E2E reframe fullscreen trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert([
      reservation(trip.id, 'Tokyo', 35.6762, 139.6503, '2026-09-10T06:00:00.000Z', '2026-09-12T06:00:00.000Z'),
      reservation(trip.id, 'Brussels', 50.8503, 4.3517, '2026-09-15T06:00:00.000Z', '2026-09-17T06:00:00.000Z'),
    ])
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    async function expectPreviewFraming(cycle: string) {
      const previewMap = page.getByTestId('map').first()
      await expect(previewMap, `${cycle}: preview map should be visible`).toBeVisible()
      await expect(previewMap.getByTitle('Brussels'), `${cycle}: Brussels (destination) should be framed`).toBeVisible()
      await expect(
        previewMap.getByTitle('Tokyo'),
        `${cycle}: Tokyo (pre-flight home) should stay outside the framed viewport`,
      ).not.toBeVisible()
    }

    async function expectFullscreenFraming(cycle: string) {
      await page.getByRole('button', { name: 'Expand map' }).click()
      const fullscreenMap = page.locator('.fixed.inset-0.z-50')
      await expect(fullscreenMap, `${cycle}: fullscreen map should be visible`).toBeVisible()
      await expect(fullscreenMap.getByTitle('Brussels'), `${cycle}: fullscreen Brussels should be framed`).toBeVisible()
      await expect(
        fullscreenMap.getByTitle('Tokyo'),
        `${cycle}: fullscreen Tokyo (pre-flight home) should stay outside the framed viewport`,
      ).not.toBeVisible()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(fullscreenMap).toHaveCount(0)
    }

    await expectPreviewFraming('first load, preview')
    await expectFullscreenFraming('first load, fullscreen')

    for (let i = 1; i <= 3; i++) {
      await page.getByRole('link', { name: 'Budget', exact: true }).click()
      await expect(page.getByTestId('map')).toHaveCount(0)

      await page.getByRole('link', { name: 'Overview', exact: true }).first().click()
      await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

      await expectPreviewFraming(`return visit ${i}, preview`)
      await expectFullscreenFraming(`return visit ${i}, fullscreen`)
    }
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

// Overview/Planning is a toggle-state of the same route (CLAUDE.md #17), not a route
// change — but OverviewScreen only renders <OverviewMap> inside `activeTab === 'overview'`
// (OverviewScreen.tsx:286-290), so toggling to Planning and back still unmounts/remounts
// the map, just without ever leaving `/trips/{id}`. This is arguably the most common
// "leave and return to Overview" interaction, so it gets its own check.
test('Overview map keeps correct framing after toggling to Planning and back', async ({ page, registerTrip }) => {
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
    .insert({ organizer_id: user.id, name: `E2E reframe planning trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert([
      reservation(trip.id, 'Tokyo', 35.6762, 139.6503, '2026-09-10T06:00:00.000Z', '2026-09-12T06:00:00.000Z'),
      reservation(trip.id, 'Brussels', 50.8503, 4.3517, '2026-09-15T06:00:00.000Z', '2026-09-17T06:00:00.000Z'),
    ])
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    const overviewMap = page.getByTestId('map').first()

    async function expectCorrectFraming(cycle: string) {
      await expect(overviewMap, `${cycle}: map should be visible`).toBeVisible()
      await expect(overviewMap.getByTitle('Brussels'), `${cycle}: Brussels (destination) should be framed`).toBeVisible()
      await expect(
        overviewMap.getByTitle('Tokyo'),
        `${cycle}: Tokyo (pre-flight home) should stay outside the framed viewport`,
      ).not.toBeVisible()
    }

    await expectCorrectFraming('first load')

    for (let i = 1; i <= 3; i++) {
      await page.getByRole('link', { name: 'Planning', exact: true }).click()
      await expect(page.getByTestId('map')).toHaveCount(0)

      await page.getByRole('link', { name: 'Overview', exact: true }).first().click()
      await expectCorrectFraming(`return visit ${i}`)
    }
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
