import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-211 (reopened 11/08) — the ticket claimed Transport reservations became
// editable from the detail screen, but shipped with no browser-level coverage at
// all. This spec is that missing verification: the departure/arrival date and
// time must be real, enabled inputs on a saved point-to-point Transport (not the
// read-only leg summary above the form), an edit must persist, and correcting a
// defaulted departure time must clear its "Default" flag.
//
// It also covers the Currency field, which showed up empty on the same screen:
// currency is always inherited from the trip (TABI-16), so a reservation saved
// without a price — price_currency still null — must display the trip's currency
// rather than a blank box, and entering a price here must write that currency.

test('a saved point-to-point Transport is editable from the detail screen', async ({
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
      name: `E2E transport detail trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'JPY',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // No price at creation, so price_currency is null — the exact shape that rendered
    // an empty Currency box on the detail screen.
    const { data: reservation, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        name: `E2E transport detail ${runId}`,
        start_at: '2026-09-12T00:00:00.000Z',
        start_timezone: 'UTC',
        start_time_is_default: true,
        end_at: '2026-09-12T03:00:00.000Z',
        end_timezone: 'UTC',
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: `E2E transport detail ${runId}` })).toBeVisible()

    // The four date/time fields exist, are enabled, hold the stored values, and are named
    // after the legs they edit — matching the read-only Departure/Arrival rows above them.
    const startDate = page.getByLabel('Departure date')
    const startTime = page.getByLabel('Departure time')
    const endDate = page.getByLabel('Arrival date')
    const endTime = page.getByLabel('Arrival time')
    for (const field of [startDate, startTime, endDate, endTime]) {
      await expect(field).toBeVisible()
      await expect(field).toBeEnabled()
    }
    await expect(startDate).toHaveValue('2026-09-12')
    await expect(startTime).toHaveValue('00:00')
    await expect(endDate).toHaveValue('2026-09-12')
    await expect(endTime).toHaveValue('03:00')

    // TABI-16: currency is inherited from the trip, never blank and never per-reservation.
    await expect(page.getByLabel('Currency')).toHaveValue('JPY')

    // Screenshot once everything above has settled — the visual record of this screen.
    await page.screenshot({ path: 'test-results/transport-detail-screen.png', fullPage: true })

    await startTime.fill('08:30')
    await endTime.fill('11:45')
    await page.getByLabel('Price').fill('12000')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved')).toBeVisible()

    const { data: saved, error: refetchError } = await client
      .from('reservations')
      .select('*')
      .eq('id', reservation.id)
      .single()
    if (refetchError || !saved) throw refetchError ?? new Error('Reservation disappeared')

    expect(new Date(saved.start_at!).toISOString()).toBe('2026-09-12T08:30:00.000Z')
    expect(new Date(saved.end_at!).toISOString()).toBe('2026-09-12T11:45:00.000Z')
    // A guessed departure time that the traveller has now confirmed is no longer a default.
    expect(saved.start_time_is_default).toBe(false)
    expect(saved.price_amount).toBe(12000)
    expect(saved.price_currency).toBe('JPY')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
