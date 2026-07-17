import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-63 — "Stockage des timestamps en UTC + fuseau horaire par lieu".
// Seeds a single reservation whose start and end legs share the exact same
// UTC instant but carry different per-location timezones (Asia/Tokyo vs
// America/Los_Angeles). If the UI is truly converting from a UTC source of
// truth per-leg (rather than displaying the raw stored value, or applying
// one global timezone to everything), the two legs must render as visibly
// different local dates/times even though they're the same instant.

const SHARED_INSTANT_UTC = '2026-08-10T23:30:00.000Z'

test('the same UTC instant renders as the correct local time for each leg timezone', async ({ page }) => {
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
    .insert({ organizer_id: user.id, name: `E2E TZ trip ${runId}`, start_date: null, end_date: null })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const { error: reservationError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      name: `E2E TZ stay ${runId}`,
      start_at: SHARED_INSTANT_UTC,
      start_timezone: 'Asia/Tokyo',
      end_at: SHARED_INSTANT_UTC,
      end_timezone: 'America/Los_Angeles',
    })
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}/stay`)

    const row = page.locator('li').filter({ hasText: `E2E TZ stay ${runId}` })

    // Tokyo is UTC+9 with no DST: 23:30 UTC -> next day, 08:30 local.
    await expect(row).toContainText('Aug 11, 2026, 8:30 AM')
    // Los Angeles is UTC-7 (PDT) in August: 23:30 UTC -> same day, 16:30 local.
    await expect(row).toContainText('Aug 10, 2026, 4:30 PM')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
