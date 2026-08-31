import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-88 — "Direct transfer" badge: when the Routes API's own transit steps show two
// consecutive TRANSIT legs sharing a station name (no WALK step between them), the
// "Getting Around" leg row surfaces it. This never guesses — it only ever reflects the
// real /api/travel-time result's hasDirectTransfer field, which api/travel-time.ts derives
// straight from computeRoutes' routes.legs.steps (see its hasDirectTransfer()/
// normalizeStationName() helpers) — never AI-generated, per the "AI never invents facts"
// architecture principle applied even to non-AI code paths.

test('a same-station transfer shows the Direct transfer badge', async ({ page, registerTrip }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/travel-time', async (route) => {
    const body = route.request().postDataJSON() as { mode: string }
    if (body.mode === 'TRANSIT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ durationSeconds: 5400, distanceMeters: 400000, hasDirectTransfer: true }),
      })
    } else {
      await route.continue()
    }
  })

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
      name: `E2E same-station transfer badge trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-13',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { data: stayA, error: stayAError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: 'E2E Stay Tokyo',
        status: 'booked',
        start_at: '2026-09-10T00:00:00.000Z',
        end_at: '2026-09-11T01:00:00.000Z',
        start_address: 'Tokyo Station, Tokyo, Japan',
        start_lat: 35.6812,
        start_lng: 139.7671,
        start_place_name: 'Tokyo Station',
        start_city: 'Tokyo',
        start_timezone: 'Asia/Tokyo',
      })
      .select()
      .single()
    if (stayAError || !stayA) throw stayAError ?? new Error('Stay A insert returned no row')

    const { data: stayB, error: stayBError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: 'E2E Stay Osaka',
        status: 'booked',
        start_at: '2026-09-11T06:00:00.000Z',
        end_at: '2026-09-12T01:00:00.000Z',
        start_address: 'Osaka Station, Osaka, Japan',
        start_lat: 34.7024,
        start_lng: 135.4959,
        start_place_name: 'Osaka Station',
        start_city: 'Osaka',
        start_timezone: 'Asia/Tokyo',
      })
      .select()
      .single()
    if (stayBError || !stayB) throw stayBError ?? new Error('Stay B insert returned no row')

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByText('E2E Stay Tokyo → E2E Stay Osaka')).toBeVisible()

    const legRow = page.getByRole('listitem').filter({ hasText: 'E2E Stay Tokyo → E2E Stay Osaka' })

    // No badge before a transit result has been computed.
    await expect(legRow.getByText('Direct transfer', { exact: true })).toHaveCount(0)

    await page.getByRole('radio', { name: 'Transit' }).click()
    await expect(legRow.getByText('Direct transfer', { exact: true })).toBeVisible({ timeout: 15_000 })

    // Switching to a mode with no transit steps clears the badge — it's never sticky
    // across an unrelated mode change.
    await page.getByRole('radio', { name: 'Drive' }).click()
    await expect(legRow.getByText('Direct transfer', { exact: true })).toHaveCount(0)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
