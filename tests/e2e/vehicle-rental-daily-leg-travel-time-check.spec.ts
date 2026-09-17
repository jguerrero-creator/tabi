import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-128 — validates a daily leg's planned time slot (arrival − departure) against the
// real Routes API drive-time estimate (same fetchTravelTime() integration Getting Around
// and point-to-point Transport already use). Real Google Places Autocomplete + Routes API
// calls, same as reservation-place-autocomplete.spec.ts — no mocking layer exists for
// external network in the e2e dev server.
test.skip(
  !process.env.VITE_GOOGLE_MAPS_API_KEY,
  'requires VITE_GOOGLE_MAPS_API_KEY configured in .env.local to hit the real Places/Routes APIs',
)

test('a too-short planned slot shows a non-blocking travel-time warning; a generous slot and a routeless leg save straight through', async ({
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
      name: `E2E travel-time check trip ${runId}`,
      start_date: '2026-11-10',
      end_date: '2026-11-20',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const rentalName = `E2E rental travel-time check ${runId}`
    const { data: reservation, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'at_disposal',
        status: 'booked',
        name: rentalName,
        start_at: '2026-11-10T09:00:00.000Z',
        start_timezone: 'UTC',
        end_at: '2026-11-18T09:00:00.000Z',
        end_timezone: 'UTC',
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: rentalName })).toBeVisible()

    async function fillLeg(dateStr: string, departureQuery: string, departureTime: string, arrivalQuery: string, arrivalTime: string) {
      await page.getByRole('button', { name: '+ Add leg' }).click()
      await expect(page.getByRole('heading', { name: 'Add leg' })).toBeVisible()
      await page.getByLabel('Date', { exact: true }).fill(dateStr)

      await page.getByLabel('Departure place').fill(departureQuery)
      const departureOption = page.getByRole('listbox').getByRole('option').first()
      await expect(departureOption).toBeVisible()
      await departureOption.click()
      await page.getByLabel('Departure time').fill(departureTime)

      await page.getByLabel('Arrival place').fill(arrivalQuery)
      const arrivalOption = page.getByRole('listbox').getByRole('option').first()
      await expect(arrivalOption).toBeVisible()
      await arrivalOption.click()
      await page.getByLabel('Arrival time').fill(arrivalTime)
    }

    // --- Leg 1: Tokyo Station -> Osaka Station (~500km, ~6h real drive), planned as 1h.
    // The warning must appear, with accurate numbers, and "Save anyway" must still save it.
    await fillLeg('2026-11-11', 'Tokyo Station', '09:00', 'Osaka Station', '10:00')
    await page.getByRole('button', { name: 'Save' }).last().click()

    await expect(page.getByRole('heading', { name: 'Tight travel time' })).toBeVisible()
    const warningMessage = page.getByText(/Google estimates .* of driving, you planned 1h — confirm anyway\?/)
    await expect(warningMessage).toBeVisible()

    await page.getByRole('button', { name: 'Save anyway' }).click()
    await expect(page.getByRole('heading', { name: 'Add leg' })).not.toBeVisible()
    await expect(page.getByText('Wed, Nov 11')).toBeVisible()

    // --- Leg 2: same route, planned as a generous 14h slot — no warning, saves straight through.
    await fillLeg('2026-11-12', 'Tokyo Station', '06:00', 'Osaka Station', '20:00')
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/vehicle_rental_legs') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Save' }).last().click(),
    ])
    await expect(page.getByRole('heading', { name: 'Tight travel time' })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Add leg' })).not.toBeVisible()
    await expect(page.getByText('Thu, Nov 12')).toBeVisible()

    // --- Leg 3: Tokyo Station -> Honolulu — no drivable route. Must save without any
    // dialog or error, not hang on a missing-data comparison.
    await fillLeg('2026-11-13', 'Tokyo Station', '09:00', 'Honolulu, Hawaii', '10:00')
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/vehicle_rental_legs') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Save' }).last().click(),
    ])
    await expect(page.getByRole('heading', { name: 'Tight travel time' })).not.toBeVisible()
    await expect(page.getByText(/Something went wrong/)).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Add leg' })).not.toBeVisible()
    await expect(page.getByText('Fri, Nov 13')).toBeVisible()

    const { data: savedLegs, error: legsFetchError } = await client
      .from('vehicle_rental_legs')
      .select('*')
      .eq('reservation_id', reservation.id)
      .order('date', { ascending: true })
    if (legsFetchError) throw legsFetchError
    expect(savedLegs).toHaveLength(3)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
