import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-127 — daily legs (departure/arrival place + time, per date) inside a
// Vehicle Rental (at_disposal) reservation's detail screen. Real Google
// Places Autocomplete calls, same as reservation-place-autocomplete.spec.ts —
// no mocking layer exists for external network in the e2e dev server.
test.skip(
  !process.env.VITE_GOOGLE_MAPS_API_KEY,
  'requires VITE_GOOGLE_MAPS_API_KEY configured in .env.local to hit the real Places Autocomplete API',
)

test('adding daily legs to a vehicle rental: in-range legs save and list, an out-of-range date is rejected', async ({
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
      name: `E2E daily legs trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-15',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const rentalName = `E2E rental with daily legs ${runId}`
    const { data: reservation, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'at_disposal',
        status: 'booked',
        name: rentalName,
        start_at: '2026-09-10T09:00:00.000Z',
        start_timezone: 'UTC',
        end_at: '2026-09-13T09:00:00.000Z',
        end_timezone: 'UTC',
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: rentalName })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Daily legs', exact: true })).toBeVisible()
    await expect(page.getByText('No daily legs added yet.')).toBeVisible()

    // --- Leg 1: an in-range date, should save and render in the list ---
    await page.getByRole('button', { name: '+ Add leg' }).click()
    await expect(page.getByRole('heading', { name: 'Add leg' })).toBeVisible()

    await page.getByLabel('Date', { exact: true }).fill('2026-09-11')

    await page.getByLabel('Departure place').fill('Tokyo Station')
    const departureOption = page.getByRole('listbox').getByRole('option').first()
    await expect(departureOption).toBeVisible()
    await departureOption.click()
    await page.getByLabel('Departure time').fill('09:00')

    await page.getByLabel('Arrival place').fill('Shibuya Station')
    const arrivalOption = page.getByRole('listbox').getByRole('option').first()
    await expect(arrivalOption).toBeVisible()
    await arrivalOption.click()
    await page.getByLabel('Arrival time').fill('10:30')

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/vehicle_rental_legs') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Save' }).last().click(),
    ])
    expect(insertResponse.ok()).toBe(true)

    await expect(page.getByRole('heading', { name: 'Add leg' })).not.toBeVisible()
    await expect(page.getByText('Fri, Sep 11')).toBeVisible()
    await expect(page.getByText(/Departure:.*·.*09:00/)).toBeVisible()
    await expect(page.getByText(/Arrival:.*·.*10:30/)).toBeVisible()

    const { data: savedLegs, error: legsFetchError } = await client
      .from('vehicle_rental_legs')
      .select('*')
      .eq('reservation_id', reservation.id)
    if (legsFetchError) throw legsFetchError
    expect(savedLegs).toHaveLength(1)
    expect(savedLegs![0].date).toBe('2026-09-11')
    expect(savedLegs![0].departure_lat).not.toBeNull()
    expect(savedLegs![0].arrival_lat).not.toBeNull()

    // --- Leg 2: a date outside the rental's pickup/drop-off range must be rejected ---
    await page.getByRole('button', { name: '+ Add leg' }).click()
    await expect(page.getByRole('heading', { name: 'Add leg' })).toBeVisible()

    await page.getByLabel('Date', { exact: true }).fill('2026-09-20')
    await page.getByLabel('Departure place').fill('Tokyo Station')
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible()
    await page.getByRole('listbox').getByRole('option').first().click()
    await page.getByLabel('Departure time').fill('09:00')
    await page.getByLabel('Arrival place').fill('Shibuya Station')
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible()
    await page.getByRole('listbox').getByRole('option').first().click()
    await page.getByLabel('Arrival time').fill('10:30')

    await page.getByRole('button', { name: 'Save' }).last().click()
    await expect(page.getByText("This date falls outside the rental's pick-up–drop-off range.")).toBeVisible()
    // Still open — rejected, not saved.
    await expect(page.getByRole('heading', { name: 'Add leg' })).toBeVisible()

    const { data: legsAfterRejection, error: legsAfterRejectionError } = await client
      .from('vehicle_rental_legs')
      .select('*')
      .eq('reservation_id', reservation.id)
    if (legsAfterRejectionError) throw legsAfterRejectionError
    expect(legsAfterRejection).toHaveLength(1)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
