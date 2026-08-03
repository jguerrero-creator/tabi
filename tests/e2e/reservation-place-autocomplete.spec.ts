import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-133 — Google Places Autocomplete on address fields. Exercises the
// live suggestion dropdown (real Google Places API calls, no mocking layer
// exists for external network in the e2e dev server) both via mouse
// selection and keyboard-only selection, and verifies the resolved
// coordinates + place name are what actually get persisted.

test.skip(
  !process.env.VITE_GOOGLE_MAPS_API_KEY,
  'requires VITE_GOOGLE_MAPS_API_KEY configured in .env.local to hit the real Places Autocomplete API',
)

test('selecting an Autocomplete suggestion by click fills the address and saves coordinates', async ({ page, registerTrip }) => {
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
      name: `E2E autocomplete trip ${runId}`,
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
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const reservationName = `E2E autocomplete click ${runId}`
    await page.getByLabel('Name').fill(reservationName)

    const addressInput = page.getByLabel('Address')
    await addressInput.fill('Park Hyatt Tokyo')
    const firstOption = page.getByRole('listbox').getByRole('option').first()
    await expect(firstOption).toBeVisible()
    await firstOption.click()

    await expect(addressInput).not.toHaveValue('Park Hyatt Tokyo')
    await expect(addressInput).not.toHaveValue('')

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

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.start_lat).not.toBeNull()
    expect(created.start_lng).not.toBeNull()
    expect(created.start_place_name).not.toBeNull()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('selecting an Autocomplete suggestion via keyboard fills the address and saves coordinates', async ({
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
    .insert({
      organizer_id: user.id,
      name: `E2E autocomplete kbd trip ${runId}`,
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
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const reservationName = `E2E autocomplete kbd ${runId}`
    await page.getByLabel('Name').fill(reservationName)

    const addressInput = page.getByLabel('Address')
    await addressInput.fill('Park Hyatt Tokyo')
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible()
    await addressInput.press('ArrowDown')
    await addressInput.press('Enter')

    await expect(addressInput).not.toHaveValue('Park Hyatt Tokyo')
    await expect(addressInput).not.toHaveValue('')
    await expect(page.getByRole('listbox')).toHaveCount(0)

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

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.start_lat).not.toBeNull()
    expect(created.start_lng).not.toBeNull()
    expect(created.start_place_name).not.toBeNull()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
