import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-167 — billing-disabled/quota-exceeded/invalid-key failures on the Maps
// JavaScript API arrive via the global window.gm_authFailure callback, not a
// thrown exception, so MapErrorBoundary's componentDidCatch never sees them
// (unlike the TABI-161 RefererNotAllowedMapError case, which does throw).
// Rather than provisioning a real over-quota/billing-disabled API key, this
// simulates the failure by invoking window.gm_authFailure() directly in the
// browser — the same call Google itself makes when it detects the failure.

test.skip(
  !process.env.VITE_GOOGLE_MAPS_API_KEY,
  'requires VITE_GOOGLE_MAPS_API_KEY configured in .env.local to mount a real map',
)

test('window.gm_authFailure shows the map fallback instead of leaving the map silently broken', async ({
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
      name: `E2E map auth failure trip ${runId}`,
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
        status: 'booked',
        name: `E2E map auth failure reservation ${runId}`,
        start_at: '2026-09-10T06:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: '2026-09-12T02:00:00.000Z',
        end_timezone: 'Asia/Tokyo',
        start_lat: 35.6586,
        start_lng: 139.7454,
        start_place_name: 'Tokyo Tower',
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: reservation.name })).toBeVisible()

    // The map has a resolved point and a real API key, so it renders the actual
    // map rather than MiniMap's own "no key / no points" fallback — confirm
    // we're looking at the live map, not that unrelated fallback, before
    // simulating the failure.
    await expect(page.getByText('Map unavailable right now.')).not.toBeVisible()

    await page.evaluate(() => window.gm_authFailure?.())

    await expect(page.getByText('Map unavailable right now.')).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
