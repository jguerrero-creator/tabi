import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-112 addendum (25/07) + TABI-160 — the detail screen's nights field
// mirrors AddReservationModal's nights editing (TABI-160) but its <form> was
// missing noValidate, so the native min={1} constraint intercepted 0/negative
// submissions with a browser tooltip instead of the app's own clear error.
// This verifies the detail screen surfaces the same explicit error as the
// add form, and that no update is sent to the DB.

test('editing a Stay to 0 nights in the detail screen shows a clear error, not a silent block', async ({
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
      name: `E2E detail nights trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { data: reservation, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: `E2E detail nights stay ${runId}`,
        start_at: '2026-09-10T15:00:00.000Z',
        start_timezone: 'UTC',
        end_at: '2026-09-13T11:00:00.000Z',
        end_timezone: 'UTC',
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: `E2E detail nights stay ${runId}` })).toBeVisible()

    const nightsInput = page.getByLabel('Nights')
    await expect(nightsInput).toHaveValue('3')

    await nightsInput.fill('0')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Number of nights is required.')).toBeVisible()

    const { data: unchanged, error: refetchError } = await client
      .from('reservations')
      .select('*')
      .eq('id', reservation.id)
      .single()
    if (refetchError || !unchanged) throw refetchError ?? new Error('Reservation disappeared')
    expect(new Date(unchanged.end_at!).toISOString()).toBe('2026-09-13T11:00:00.000Z')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
