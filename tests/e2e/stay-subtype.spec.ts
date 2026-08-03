import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-125 — "Sous-type Hébergement sélectionnable (Hôtel/Camping/Airbnb/
// Ryokan/Autre)". Spec: at the top of the Add sheet opened from the Stay
// menu, a sub-type choice (Hôtel/Camping/Airbnb/Ryokan/Autre) is stored in
// the `stay_subtype` column; the main type (Stay) is inherited from the
// origin menu, not re-selected. Symmetric to TABI-121 (transport sub-type).
// Exercises picking a non-default sub-type (Camping) end to end.

test('selecting a Stay sub-type in the Add sheet persists stay_subtype', async ({ page, registerTrip }) => {
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
      name: `E2E stay subtype trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    // Main type is inherited from the Stay menu, collapsed by default (TABI-126) — no
    // "Type" selector shown, just the sub-type picker with Hotel selected by default.
    await expect(page.getByLabel('Type')).toHaveCount(0)
    await expect(page.getByRole('radio', { name: 'Hotel' })).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('radio', { name: 'Camping' }).click()
    await expect(page.getByRole('radio', { name: 'Camping' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radio', { name: 'Hotel' })).toHaveAttribute('aria-checked', 'false')

    const reservationName = `E2E camping ${runId}`
    await page.getByLabel('Name').fill(reservationName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Start time').fill('15:00')
    await page.getByRole('button', { name: 'Enter checkout date manually' }).click()
    await page.getByLabel('End date').fill('2026-09-12')
    await page.getByLabel('End time').fill('11:00')

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(reservationName)).toBeVisible()

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.type).toBe('stay')
    expect(created.stay_subtype).toBe('camping')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
