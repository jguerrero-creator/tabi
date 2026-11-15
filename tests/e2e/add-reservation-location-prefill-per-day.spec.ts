import type { Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-267 — "Formulaire d'ajout : adresse par defaut = lieu de la journee". Resolves
// the Add form's default address PER DAY: (1) the day's own explicit planned location,
// (2) else the accommodation active that night, (3) else the TABI-204 trip-wide fallback
// (lastKnownTripLocation), (4) else empty. Scope: place-subtype Activity and Meal, and
// Transport's own start/departure address — Stay keeps the old TABI-204 behavior
// unchanged. Every trip here is throwaway, never the real "Japon décembre" trip.

type Client = Awaited<ReturnType<typeof authenticatedClientFor>>

async function createTrip(client: Client, name: string) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, start_date: '2026-09-10', end_date: '2026-09-20', currency: 'USD' })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

async function cleanupTrip(client: Client, tripId: string) {
  await client.from('trip_day_locations').delete().eq('trip_id', tripId)
  await client.from('reservations').delete().eq('trip_id', tripId)
  await client.from('trips').delete().eq('id', tripId)
}

async function blockGoogleMaps(page: Page) {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
}

async function openPlanningDay(page: Page, tripId: string, dayPillLabel: string) {
  await page.goto(`/trips/${tripId}`)
  await page.getByRole('button', { name: 'Planning' }).click()
  await expect(page.getByRole('button', { name: dayPillLabel })).toBeVisible()
  await page.getByRole('button', { name: dayPillLabel }).click()
}

async function openActivityFromFreeBlock(page: Page) {
  const addFreeBlockButton = page.getByRole('button', { name: 'Add something here' })
  await expect(addFreeBlockButton).toBeVisible()
  await addFreeBlockButton.click()

  // When the day already has a resolved contextual location (an active accommodation or
  // planned location — TABI-24's resolveContextualLocation), OverviewScreen's
  // handleAddAtFreeBlock opens the nearby-places search first instead of the plain form.
  // With Google Maps blocked that search fails, surfacing the same "Enter manually
  // instead" fallback the Activities type-menu flow already uses — fall through it to
  // reach the form. A day with no resolvable context (no stay, no planned location)
  // skips that step entirely and opens the form directly.
  const enterManually = page.getByRole('button', { name: 'Enter manually instead' })
  const addReservationHeading = page.getByRole('heading', { name: 'Add Reservation' })
  await Promise.race([
    enterManually.waitFor({ state: 'visible' }),
    addReservationHeading.waitFor({ state: 'visible' }),
  ])
  if (await enterManually.isVisible()) {
    await enterManually.click()
  }

  await expect(addReservationHeading).toBeVisible()
  // Free-block quick-add opens with the type selector expanded (TABI-54) — pre-selected
  // on Activity, which is exactly the type this scenario exercises.
  await expect(page.getByLabel('Type')).toHaveValue('activity')
}

async function openActivityFromTypeMenu(page: Page, tripId: string) {
  await page.goto(`/trips/${tripId}/activities`)
  await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible()
  await blockGoogleMaps(page)
  await page.getByRole('button', { name: 'Add activity' }).click()
  await expect(page.getByRole('heading', { name: 'Find a place' })).toBeVisible()
  await page.getByRole('button', { name: 'Enter manually instead' }).click()
  await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
}

test('a day with an explicit planned location beats the accommodation active that same night', async ({
  page,
  registerTrip,
}) => {
  // The Planning day-pill rail (where the free-block "+" lives) only renders below the
  // `lg` breakpoint — same constraint as TABI-54's timeline-manual-block spec.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill planned-beats-stay ${runId}`)
  registerTrip(client, trip.id)

  try {
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E stay ${runId}`,
      start_at: '2026-09-10T00:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-09-20T00:00:00.000Z',
      end_timezone: 'UTC',
      start_address: 'Shinjuku Hotel, Tokyo',
      start_lat: 35.6938,
      start_lng: 139.7034,
      start_city: 'Tokyo',
    })
    if (stayError) throw stayError

    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-15',
      place_name: 'Shibuya',
      address: 'Shibuya, Tokyo',
      lat: 35.6617,
      lng: 139.704,
      city: 'Tokyo',
      timezone: 'UTC',
    })
    if (dayLocationError) throw dayLocationError

    await blockGoogleMaps(page)
    await openPlanningDay(page, trip.id, 'Sep 15')
    await openActivityFromFreeBlock(page)

    await expect(page.getByLabel('Address')).toHaveValue('Shibuya, Tokyo')
    await expect(page.getByText("This day's location")).toBeVisible()

    await page.screenshot({ path: 'test-results/add-reservation-per-day-prefill-390.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: 'test-results/add-reservation-per-day-prefill-1440.png', fullPage: true })
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('a day with only an active accommodation (no explicit planned location) prefills with it', async ({
  page,
  registerTrip,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill accommodation ${runId}`)
  registerTrip(client, trip.id)

  try {
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E stay ${runId}`,
      start_at: '2026-09-10T00:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-09-20T00:00:00.000Z',
      end_timezone: 'UTC',
      start_address: 'Shinjuku Hotel, Tokyo',
      start_lat: 35.6938,
      start_lng: 139.7034,
      start_city: 'Tokyo',
    })
    if (stayError) throw stayError

    await blockGoogleMaps(page)
    await openPlanningDay(page, trip.id, 'Sep 16')
    await openActivityFromFreeBlock(page)

    await expect(page.getByLabel('Address')).toHaveValue('Shinjuku Hotel, Tokyo')
    // Accommodation-sourced, not the day-location-specific hint.
    await expect(page.getByText("This day's location")).not.toBeVisible()
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('a day with neither a planned location nor an accommodation falls back to the trip-wide last-known location', async ({
  page,
  registerTrip,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill fallback ${runId}`)
  registerTrip(client, trip.id)

  try {
    const { error: flightError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: `E2E flight ${runId}`,
      start_at: '2026-09-10T01:00:00.000Z',
      start_timezone: 'UTC',
      start_address: 'Departure gate',
      start_lat: 1,
      start_lng: 1,
      end_at: '2026-09-10T04:00:00.000Z',
      end_timezone: 'UTC',
      end_address: 'Narita Airport, Tokyo',
      end_lat: 35.7719,
      end_lng: 140.3929,
      end_city: 'Tokyo',
    })
    if (flightError) throw flightError

    await blockGoogleMaps(page)
    // No stay, no day-location at all on 2026-09-16 — a pure transit day.
    await openPlanningDay(page, trip.id, 'Sep 16')
    await openActivityFromFreeBlock(page)

    await expect(page.getByLabel('Address')).toHaveValue('Narita Airport, Tokyo')
    await expect(page.getByText("This day's location")).not.toBeVisible()
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('a typed address is never overwritten when a start date is picked afterward', async ({ page, registerTrip }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill typed-not-overwritten ${runId}`)
  registerTrip(client, trip.id)

  try {
    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-15',
      place_name: 'Shibuya',
      address: 'Shibuya, Tokyo',
      lat: 35.6617,
      lng: 139.704,
      city: 'Tokyo',
      timezone: 'UTC',
    })
    if (dayLocationError) throw dayLocationError

    await openActivityFromTypeMenu(page, trip.id)

    const addressField = page.getByLabel('Address')
    await addressField.fill('My own typed address')
    await expect(addressField).toHaveValue('My own typed address')

    await page.getByLabel('Start date').fill('2026-09-15')
    // Give the day-aware recompute effect a moment to (not) fire.
    await page.waitForTimeout(300)

    await expect(addressField).toHaveValue('My own typed address')
    await expect(page.getByText("This day's location")).not.toBeVisible()
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('picking a start date recomputes an untouched auto-filled address to that day\'s planned location', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill recompute ${runId}`)
  registerTrip(client, trip.id)

  try {
    // Deliberately LATER than the 2026-09-15 day-location below, so the plain TABI-204
    // trip-wide fallback (the globally most-recent known location, no day in mind) picks
    // this flight, not the day-location — isolating the "recompute on date pick" effect
    // from TABI-204's own unrelated recency comparison.
    const { error: flightError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: `E2E flight ${runId}`,
      start_at: '2026-09-19T01:00:00.000Z',
      start_timezone: 'UTC',
      start_address: 'Departure gate',
      start_lat: 1,
      start_lng: 1,
      end_at: '2026-09-19T04:00:00.000Z',
      end_timezone: 'UTC',
      end_address: 'Narita Airport, Tokyo',
      end_lat: 35.7719,
      end_lng: 140.3929,
      end_city: 'Tokyo',
    })
    if (flightError) throw flightError

    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-15',
      place_name: 'Shibuya',
      address: 'Shibuya, Tokyo',
      lat: 35.6617,
      lng: 139.704,
      city: 'Tokyo',
      timezone: 'UTC',
    })
    if (dayLocationError) throw dayLocationError

    await openActivityFromTypeMenu(page, trip.id)

    const addressField = page.getByLabel('Address')
    // No date picked yet — falls straight to the trip-wide fallback (TABI-204's old behavior).
    await expect(addressField).toHaveValue('Narita Airport, Tokyo')

    await page.getByLabel('Start date').fill('2026-09-15')
    await expect(addressField).toHaveValue('Shibuya, Tokyo')
    await expect(page.getByText("This day's location")).toBeVisible()
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('Transport prefills only the departure address from the day\'s location — arrival stays empty', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill transport ${runId}`)
  registerTrip(client, trip.id)

  try {
    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-15',
      place_name: 'Shibuya',
      address: 'Shibuya, Tokyo',
      lat: 35.6617,
      lng: 139.704,
      city: 'Tokyo',
      timezone: 'UTC',
    })
    if (dayLocationError) throw dayLocationError

    await page.goto(`/trips/${trip.id}/transport`)
    await expect(page.getByRole('heading', { name: 'Transport' })).toBeVisible()
    await blockGoogleMaps(page)
    await page.getByRole('button', { name: 'Add reservation (Transport)' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    await page.getByLabel('Start date').fill('2026-09-15')

    await expect(page.getByLabel('Departure address')).toHaveValue('Shibuya, Tokyo')
    await expect(page.getByLabel('Arrival address')).toHaveValue('')
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('a place-subtype Meal is prefilled from the day\'s location, same as Activity', async ({ page, registerTrip }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill meal ${runId}`)
  registerTrip(client, trip.id)

  try {
    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-15',
      place_name: 'Shibuya',
      address: 'Shibuya, Tokyo',
      lat: 35.6617,
      lng: 139.704,
      city: 'Tokyo',
      timezone: 'UTC',
    })
    if (dayLocationError) throw dayLocationError

    await page.goto(`/trips/${trip.id}/meals`)
    await expect(page.getByRole('heading', { name: 'Meals' })).toBeVisible()
    await blockGoogleMaps(page)
    await page.getByRole('button', { name: 'Add reservation (Meal)' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    await page.getByLabel('Start date').fill('2026-09-15')
    await expect(page.getByLabel('Address')).toHaveValue('Shibuya, Tokyo')
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('Stay keeps the old trip-wide TABI-204 behavior, never adopting a day\'s own planned location', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E per-day prefill stay-unchanged ${runId}`)
  registerTrip(client, trip.id)

  try {
    // TABI-111 will prefill the Stay's own start date to the trip's first night,
    // 2026-09-10, since nothing is booked yet — give THAT exact day its own planned
    // location, deliberately different from the trip-wide fallback below, so the two
    // are distinguishable in the assertion.
    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-10',
      place_name: 'Shibuya',
      address: 'Shibuya, Tokyo',
      lat: 35.6617,
      lng: 139.704,
      city: 'Tokyo',
      timezone: 'UTC',
    })
    if (dayLocationError) throw dayLocationError

    // Deliberately LATER than the 2026-09-10 day-location above — otherwise even the
    // plain, unchanged TABI-204 trip-wide fallback would already land on Sep 10's own
    // day-location for unrelated recency reasons, and this test wouldn't actually prove
    // Stay is ignoring the day-aware resolution (it would just coincidentally agree).
    const { error: flightError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: `E2E flight ${runId}`,
      start_at: '2026-09-19T01:00:00.000Z',
      start_timezone: 'UTC',
      start_address: 'Departure gate',
      start_lat: 1,
      start_lng: 1,
      end_at: '2026-09-19T04:00:00.000Z',
      end_timezone: 'UTC',
      end_address: 'Narita Airport, Tokyo',
      end_lat: 35.7719,
      end_lng: 140.3929,
      end_city: 'Tokyo',
    })
    if (flightError) throw flightError

    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()
    await blockGoogleMaps(page)
    await page.getByRole('button', { name: 'Add reservation (Stay)' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    await expect(page.getByLabel('Start date')).toHaveValue('2026-09-10')
    await expect(page.getByLabel('Address')).toHaveValue('Narita Airport, Tokyo')
    await expect(page.getByText("This day's location")).not.toBeVisible()
  } finally {
    await cleanupTrip(client, trip.id)
  }
})
