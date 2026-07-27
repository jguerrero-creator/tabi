import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-155 — "Bouton Add pour transformer un trajet calculé en réservation Transport
// 'À réserver' (Getting Around)". Spec: once a mode is picked for a computed leg in
// "Getting Around", a "+ Add" button creates a Transport reservation from that leg
// (sub-type = the chosen mode, addresses/mode already known), status "To book", with
// start time defaulted to the trip's day-window start — not the leg's own computed
// departure instant — since the exact time isn't confirmed yet at this placeholder stage.

test('"+ Add" on a computed Getting Around leg opens the Add sheet prefilled as a To-book Transport reservation', async ({
  page,
}) => {
  // Local dev's Maps JS API key referrer allowlist doesn't cover this Playwright-driven
  // localhost port (TABI-162, a known, unrelated infra gap — see CLAUDE.md's Maps referrer
  // gotcha). Block the map script for this test only; unrelated to the quick-add logic under
  // test.
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
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
      name: `E2E getting-around quick-add trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-13',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    // Two Stay reservations on different days/cities, geocoded directly (no UI/geocoder
    // round trip needed) so buildTripLegs computes a leg between them: departure = the
    // first stay's checkout point (its start_* fields, since a Stay has no end address),
    // arrival = the second stay's check-in point.
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

    // No mode chosen yet — the quick-add button isn't shown.
    await expect(page.getByRole('button', { name: '+ Add reservation' })).toHaveCount(0)

    await page.getByRole('radio', { name: 'Drive' }).click()
    // Wait for the real travel-time lookup to resolve before the button appears.
    await expect(page.getByRole('button', { name: '+ Add reservation' })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: '+ Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    // Prefilled from the leg: every Getting Around leg quick-adds as a point-to-point Transport.
    await expect(page.getByText('Flight / Train / Bus')).toBeVisible()
    // Status defaults to "To book" already, unaffected by the prefill.
    await expect(page.getByRole('radio', { name: 'To book' })).toHaveAttribute('aria-checked', 'true')
    // Both addresses came from the leg's own endpoints, no re-geocoding needed.
    await expect(page.getByLabel('Departure address')).toHaveValue('Tokyo Station, Tokyo, Japan')
    await expect(page.getByLabel('Arrival address')).toHaveValue('Osaka Station, Osaka, Japan')
    await expect(page.getByText('Tokyo Station → Osaka Station')).toBeVisible()

    // Start time defaults to the trip's day-window start (08:00) on the departure day
    // (2026-09-11, stayA's checkout day) — not the checkout's own 06:00-local instant.
    await expect(page.getByLabel('Start date')).toHaveValue('2026-09-11')
    await expect(page.getByLabel('Start time')).toHaveValue('08:00')
    // End time is estimated from the computed drive duration, so it's set and after start.
    await expect(page.getByLabel('End date')).toHaveValue('2026-09-11')
    const endTime = await page.getByLabel('End time').inputValue()
    expect(endTime > '08:00').toBe(true)

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(createResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .eq('type', 'transport')
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Quick-added transport reservation was not created')

    expect(created.transport_subtype).toBe('point_to_point')
    expect(created.status).toBe('to_book')
    expect(created.start_address).toBe('Tokyo Station, Tokyo, Japan')
    expect(created.end_address).toBe('Osaka Station, Osaka, Japan')
    // 2026-09-11T08:00 JST (UTC+9) — the trip's day-window start, not the checkout's own time.
    expect(new Date(created.start_at!).toISOString()).toBe('2026-09-10T23:00:00.000Z')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
