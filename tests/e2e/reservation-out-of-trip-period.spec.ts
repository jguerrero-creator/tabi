import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-113 — a reservation whose start or end falls outside the trip's current
// dates is never blocked and never silent: saving asks for an explicit,
// non-blocking confirmation with two resolutions — extend the trip to cover
// it, or confirm the extra night before/after the trip is intentional.

test('adding a reservation outside the trip dates asks to extend or keep as is', async ({ page }) => {
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
      name: `E2E out-of-period trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-15',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    // Extend path: check-in the night before the trip officially starts.
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    const extendName = `E2E out-of-period extend ${runId}`
    await page.getByLabel('Name').fill(extendName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-09')
    await page.getByLabel('Start time').fill('20:00')
    await page.getByRole('button', { name: 'Enter checkout date manually' }).click()
    await page.getByLabel('End date').fill('2026-09-11')
    await page.getByLabel('End time').fill('11:00')

    const [insertExtendResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      (async () => {
        await page.getByRole('button', { name: 'Add Reservation', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
        await page.getByRole('button', { name: 'Extend trip dates' }).click()
      })(),
    ])
    expect(insertExtendResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(extendName)).toBeVisible()

    const { data: extendedTrip, error: extendedTripError } = await client
      .from('trips')
      .select('start_date, end_date')
      .eq('id', trip.id)
      .single()
    if (extendedTripError || !extendedTrip) throw extendedTripError ?? new Error('Trip refetch returned no row')
    expect(extendedTrip.start_date).toBe('2026-09-09')
    expect(extendedTrip.end_date).toBe('2026-09-15')

    // Keep-as-is path: a night after the (now extended) trip end, confirmed intentional.
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    const keepName = `E2E out-of-period keep ${runId}`
    await page.getByLabel('Name').fill(keepName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-15')
    await page.getByLabel('Start time').fill('20:00')
    await page.getByRole('button', { name: 'Enter checkout date manually' }).click()
    await page.getByLabel('End date').fill('2026-09-16')
    await page.getByLabel('End time').fill('11:00')

    const [insertKeepResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      (async () => {
        await page.getByRole('button', { name: 'Add Reservation', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
        await page.getByRole('button', { name: 'Keep as is' }).click()
      })(),
    ])
    expect(insertKeepResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(keepName)).toBeVisible()

    const { data: unchangedTrip, error: unchangedTripError } = await client
      .from('trips')
      .select('start_date, end_date')
      .eq('id', trip.id)
      .single()
    if (unchangedTripError || !unchangedTrip) throw unchangedTripError ?? new Error('Trip refetch returned no row')
    expect(unchangedTrip.start_date).toBe('2026-09-09')
    expect(unchangedTrip.end_date).toBe('2026-09-15')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
