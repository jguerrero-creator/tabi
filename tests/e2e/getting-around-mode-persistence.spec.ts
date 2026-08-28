import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-200 — "Le mode de trajet choisi dans Getting Around n'est jamais sauvegardé". The mode
// picked for a "Getting Around" leg used to live in local React state only, resetting to "no
// mode chosen" on every reload. Separately, a leg whose only viable mode failed (e.g. Transit
// unavailable) re-fired the Routes API call and re-showed the same error banner on every single
// Overview open, since nothing persisted that the combination had already failed.
//
// This spec asserts both are fixed: (1) a successfully computed mode survives a reload without
// a fresh Routes API call, and (2) a mode that resolves to "no route" is persisted so the retry
// doesn't happen and the banner — shown once, at the moment it's first computed — stays silent
// on a later reload instead of re-firing every time.

test('a leg travel mode and its computed/failed result persist across a reload', async ({ page, registerTrip }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())

  // Simulate the real-world "Transit unavailable" gap (TABI-200's Japan case) deterministically
  // instead of depending on live Google transit coverage for a specific route.
  const travelTimeRequests: { mode: string }[] = []
  await page.route('**/api/travel-time', async (route) => {
    const body = route.request().postDataJSON() as { mode: string }
    travelTimeRequests.push({ mode: body.mode })
    if (body.mode === 'TRANSIT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ durationSeconds: null, distanceMeters: null }) })
    } else {
      await route.continue()
    }
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
    .insert({
      organizer_id: user.id,
      name: `E2E getting-around mode persistence trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-13',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { data: stayA, error: stayAError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: 'E2E Stay Tokyo',
        status: 'booked',
        start_at: '2026-09-10T00:00:00.000Z',
        end_at: '2026-09-11T01:00:00.000Z',
        start_address: 'Tokyo Station, Tokyo, Japan',
        start_lat: 35.6812,
        start_lng: 139.7671,
        start_place_name: 'Tokyo Station',
        start_city: 'Tokyo',
        start_timezone: 'Asia/Tokyo',
      })
      .select()
      .single()
    if (stayAError || !stayA) throw stayAError ?? new Error('Stay A insert returned no row')

    const { data: stayB, error: stayBError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: 'E2E Stay Osaka',
        status: 'booked',
        start_at: '2026-09-11T06:00:00.000Z',
        end_at: '2026-09-12T01:00:00.000Z',
        start_address: 'Osaka Station, Osaka, Japan',
        start_lat: 34.7024,
        start_lng: 135.4959,
        start_place_name: 'Osaka Station',
        start_city: 'Osaka',
        start_timezone: 'Asia/Tokyo',
      })
      .select()
      .single()
    if (stayBError || !stayB) throw stayBError ?? new Error('Stay B insert returned no row')

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByText('E2E Stay Tokyo → E2E Stay Osaka')).toBeVisible()

    // 1. Pick Drive — a real Routes API call resolves it, and the "+ Add reservation" button
    // appearing is proof a duration was computed.
    const driveResultPersisted = page.waitForResponse(
      (res) => res.url().includes('/rest/v1/trip_leg_travel_modes') && res.request().method() === 'PATCH',
    )
    await page.getByRole('radio', { name: 'Drive' }).click()
    await expect(page.getByRole('button', { name: '+ Add reservation' })).toBeVisible({ timeout: 15_000 })
    const driveRequestCountBeforeReload = travelTimeRequests.filter((r) => r.mode === 'DRIVE').length
    expect(driveRequestCountBeforeReload).toBe(1)
    // Same fire-and-forget persistence race as the Transit case below — wait for the computed
    // result to actually land in the DB before reloading.
    await driveResultPersisted

    // 2. Reload — the persisted mode/result must come back without a fresh Routes API call.
    await page.reload()
    await expect(page.getByText('E2E Stay Tokyo → E2E Stay Osaka')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Drive' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('button', { name: '+ Add reservation' })).toBeVisible()
    // Give any (wrongly re-fired) request a moment to land before asserting it didn't.
    await page.waitForTimeout(1000)
    expect(travelTimeRequests.filter((r) => r.mode === 'DRIVE').length).toBe(driveRequestCountBeforeReload)

    // 3. Switch to Transit — intercepted to resolve as "no route" (mirrors the real Japan Transit
    // gap). The banner should surface immediately, once, at the moment of this fresh computation.
    const persistedPromise = page.waitForResponse(
      (res) => res.url().includes('/rest/v1/trip_leg_travel_modes') && res.request().method() === 'PATCH',
    )
    await page.getByRole('radio', { name: 'Transit' }).click()
    await expect(page.getByText('Public transit unavailable for this route — check Google Maps or try another mode.')).toBeVisible({
      timeout: 15_000,
    })
    const transitRequestCountAfterFirstCompute = travelTimeRequests.filter((r) => r.mode === 'TRANSIT').length
    expect(transitRequestCountAfterFirstCompute).toBe(1)
    // Wait for the failed result to actually finish persisting before reloading — the UI shows
    // the banner as soon as it's computed, but the DB write that remembers "already failed" is
    // fire-and-forget in the background; reloading before it lands would abort it mid-flight.
    await persistedPromise

    // 4. Reload without dismissing — the failure is now persisted, so no fresh Routes API call
    // happens, AND the banner does NOT re-show (this is the literal TABI-200 symptom: the error
    // used to reappear on every single Overview open).
    await page.reload()
    await expect(page.getByText('E2E Stay Tokyo → E2E Stay Osaka')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Transit' })).toHaveAttribute('aria-checked', 'true')
    await page.waitForTimeout(1000)
    await expect(
      page.getByText('Public transit unavailable for this route — check Google Maps or try another mode.'),
    ).toHaveCount(0)
    expect(travelTimeRequests.filter((r) => r.mode === 'TRANSIT').length).toBe(transitRequestCountAfterFirstCompute)

    // 5. Picking another mode after a persisted failure works as a fresh choice again.
    await page.getByRole('radio', { name: 'Walk' }).click()
    await expect(page.getByRole('button', { name: '+ Add reservation' })).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByText('Public transit unavailable for this route — check Google Maps or try another mode.'),
    ).toHaveCount(0)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
