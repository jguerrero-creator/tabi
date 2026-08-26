import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout — see trip-timeline-day-edge-arrival-timezone.spec.ts
// for why (Planning toggle button is lg:hidden on desktop).
test.use({ viewport: { width: 390, height: 844 } })

// Bugs DB, Sévérité: Bloquant. `buildDayOccurrences`'s departure/arrival split
// (see trip-timeline-day-edge-arrival-timezone.spec.ts) only ever creates two
// occurrences — one for the departure day, one for the arrival day — so a
// Transport leg spanning 2+ calendar days has one or more days in between
// with no occurrence of its own at all. Without `findInProgressTransportLeg`
// (consulted by `computeDayEdgeFreeBlocks`/`TripTimeline`), such a day would
// have zero items and render as one big, wrong, full-day free block, even
// though the traveler is in transit the entire day. There's no realistic
// single-leg commercial flight that spans this long, but the underlying
// UTC-instant day-occupancy logic must hold regardless of duration — this
// seeds a synthetic 36-hour leg (same timezone both ends, to isolate this
// from the separate cross-timezone case already covered above) to verify it.

test('a Transport leg spanning 2+ calendar days shows every day it touches as occupied, not free', async ({
  page,
  registerTrip,
}) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
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
      name: `E2E multi-day transport span trip ${runId}`,
      start_date: '2026-11-05',
      end_date: '2026-11-07',
      currency: 'EUR',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const legName = `E2E 36h crossing ${runId}`

    // Departs 2026-11-05 20:00 CET (UTC+1, no DST in November), arrives
    // 2026-11-07 08:00 CET — 36 hours later, spanning three calendar days
    // (Nov 5, Nov 6, Nov 7). Same timezone both ends deliberately, so this
    // test isolates the multi-day-span logic from the cross-timezone case.
    const { error: legError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: legName,
      start_at: '2026-11-05T19:00:00.000Z',
      start_timezone: 'Europe/Paris',
      end_at: '2026-11-07T07:00:00.000Z',
      end_timezone: 'Europe/Paris',
    })
    if (legError) throw legError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Nov 5' })).toBeVisible()

    const mobileView = page.getByTestId('mobile-day-view')
    const mobileRailItems = page.locator('main ul').first().locator('li')

    // Departure day (Nov 5): leg shows as a Departure row. Free until
    // departure (08:00 -> 20:00 = 12h), nothing after — the traveler stays
    // in transit for the rest of the day's window.
    await expect(mobileView.getByText(legName)).toBeVisible()
    await expect(mobileView.getByText('Departure · 20:00')).toBeVisible()
    await expect(mobileView.getByText('12h free').first()).toBeVisible()
    await expect(mobileRailItems).toHaveCount(2)

    // Intermediate day (Nov 6): neither departure nor arrival lands here —
    // this is exactly the day the departure/arrival occurrence split alone
    // can't cover. Before the `findInProgressTransportLeg` fix, this
    // rendered as one big (wrong) full-day free block. It must now show the
    // leg as "In transit" and no free time at all.
    await page.getByRole('button', { name: 'Nov 6' }).click()
    await expect(mobileView.getByText('In transit')).toBeVisible()
    await expect(mobileView.getByText(legName)).toBeVisible()
    await expect(mobileView.getByText(/free/)).not.toBeVisible()
    await expect(mobileRailItems).toHaveCount(1)

    // Arrival day (Nov 7): leg shows as an Arrival row, no free time before
    // it (occupied since before the day's window opened), real trailing
    // free time after it (08:00 -> 22:00 = 14h).
    await page.getByRole('button', { name: 'Nov 7' }).click()
    await expect(mobileView.getByText(legName)).toBeVisible()
    await expect(mobileView.getByText('Arrival · 08:00')).toBeVisible()
    await expect(mobileView.getByText('14h free').first()).toBeVisible()
    await expect(mobileRailItems).toHaveCount(2)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
