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
    .insert({
      organizer_id: user.id,
      name: `E2E TZ trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const { data: created, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: `E2E TZ stay ${runId}`,
        start_at: SHARED_INSTANT_UTC,
        start_timezone: 'Asia/Tokyo',
        end_at: SHARED_INSTANT_UTC,
        end_timezone: 'America/Los_Angeles',
      })
      .select()
      .single()
    if (reservationError || !created) throw reservationError ?? new Error('Reservation insert returned no row')

    // The Stay list row only shows a nights-count summary (CLAUDE.md #14), not raw per-leg
    // date/time — the detail screen's editable check-in/check-out fields are where each leg's
    // own timezone conversion is actually surfaced, so that's what this test exercises.
    await page.goto(`/reservations/${created.id}`)
    await expect(page.getByRole('heading', { name: `E2E TZ stay ${runId}` })).toBeVisible()

    // Tokyo is UTC+9 with no DST: 23:30 UTC -> next day, 08:30 local.
    await expect(page.getByLabel('Check-in date')).toHaveValue('2026-08-11')
    await expect(page.getByLabel('Check-in time')).toHaveValue('08:30')
    // Los Angeles is UTC-7 (PDT) in August: 23:30 UTC -> same day, 16:30 local. Check-out DATE
    // isn't asserted here: by design (TABI-112) it's derived from check-in + nights rather than
    // a raw per-leg conversion, so it doesn't reflect end_timezone once check-in/check-out land
    // on different local dates. Check-out TIME is unaffected by that derivation and still comes
    // straight from end_at/end_timezone, so it's what actually proves independent per-leg
    // conversion for the checkout leg.
    await expect(page.getByLabel('Check-out time')).toHaveValue('16:30')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
