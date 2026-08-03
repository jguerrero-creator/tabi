import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-181 — Add Reservation: Activity replaces the end date/time fields with a duration
// (hours + minutes), always resolving to the same calendar day as start.
// TABI-182 — Detail screen: previously there was no UI at all to edit an Activity's start
// date/time or add a missing end/duration once it existed without one.

test('Activity duration is entered on add and editable on the detail screen', async ({ page, registerTrip }) => {
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
      name: `E2E activity duration trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // --- TABI-182: an Activity that already exists with a start but no end/duration ---
    const { data: reservation, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'activity',
        name: `E2E activity ${runId}`,
        start_at: '2026-09-05T10:00:00.000Z',
        start_timezone: 'UTC',
        end_at: null,
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: `E2E activity ${runId}` })).toBeVisible()

    await expect(page.getByLabel('Start date')).toHaveValue('2026-09-05')
    await expect(page.getByLabel('Start time')).toHaveValue('10:00')

    await page.getByLabel('Hours').fill('2')
    await page.getByLabel('Minutes').fill('30')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Something went wrong. Please try again.')).toHaveCount(0)
    // Wait for the save round-trip to land before reading it back via a separate client.
    await expect(page.getByText('Sep 5, 2026, 12:30')).toBeVisible()

    const { data: updated, error: refetchError } = await client
      .from('reservations')
      .select('*')
      .eq('id', reservation.id)
      .single()
    if (refetchError || !updated) throw refetchError ?? new Error('Reservation disappeared')
    expect(new Date(updated.end_at!).toISOString()).toBe('2026-09-05T12:30:00.000Z')

    // --- TABI-181: creating a brand-new Activity via the Add sheet with a duration ---
    await page.goto(`/trips/${trip.id}/activities`)
    await page.getByRole('button', { name: 'Add activity' }).click()
    await page.getByLabel('Name').fill(`E2E new activity ${runId}`)
    await page.locator('input[aria-label="Start date"]').fill('2026-09-06')
    await page.locator('input[aria-label="Start time"]').fill('14:00')
    await page.getByLabel('Hours').fill('1')
    await page.getByLabel('Minutes').fill('15')
    await page.getByRole('button', { name: 'Add reservation' }).click()

    await expect(page.getByText(`E2E new activity ${runId}`)).toBeVisible()

    const { data: created, error: createdError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .eq('name', `E2E new activity ${runId}`)
      .single()
    if (createdError || !created) throw createdError ?? new Error('New activity not found')
    // No address was entered, so start_at/end_at resolve in the browser's local timezone
    // (existing, pre-TABI-181 fallback behavior) — assert the derived duration instead of an
    // absolute UTC instant, and that end lands on the same calendar day as start.
    const start = new Date(created.start_at!)
    const end = new Date(created.end_at!)
    expect(end.getTime() - start.getTime()).toBe((1 * 60 + 15) * 60 * 1000)
    expect(end.toISOString().slice(0, 10)).toBe(start.toISOString().slice(0, 10))
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
