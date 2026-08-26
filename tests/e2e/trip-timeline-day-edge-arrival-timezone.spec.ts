import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout (the desktop responsive layout, `lg:hidden`,
// otherwise hides the `button`-based Overview/Planning toggle this test
// relies on — see OverviewScreen.tsx:141-160). Unrelated to the timezone fix
// under test; the existing trip-timeline-cross-timezone.spec.ts hits the same
// viewport issue against this checkout.
test.use({ viewport: { width: 390, height: 844 } })

// TABI-165 — timezone/UTC audit. `computeDayEdgeFreeBlocks` (freeTimeBlocks.ts)
// used to evaluate a day's *trailing* free-time cutoff (`dayEndTime`) in the
// day-anchoring timezone (`items[0].start_timezone`, i.e. wherever the day
// *started*) even when the day's last item is an international arrival —
// wrong once the traveler has actually landed somewhere else. The fix derives
// the trailing edge's own local calendar date and timezone from the last
// item's arrival (`end_timezone` ?? `start_timezone`) instead of reusing the
// day's start-anchored `dateKey`/`timezone`.
//
// Bugs DB, Sévérité: Bloquant — "Un trajet Transport qui traverse minuit...
// n'apparaît que sur le jour de départ". TABI-165 fixed the *time* of the
// post-arrival free block, but it still filed that block under the
// departure day's tab, and the flight itself never appeared on the arrival
// day's tab at all (which rendered as one big, wrong, full-day free block
// from day-start — the traveler was still airborne). `buildDayOccurrences`
// now splits a midnight/timezone-crossing point-to-point Transport leg into
// a departure occurrence and an arrival occurrence, exactly like it already
// did for a multi-night Stay's check-in/check-out — each getting its own
// day, its own correctly-split leading/trailing free time, and (via
// `suppressTrailingDayEdge`/`suppressLeadingDayEdge`) no free time at all
// on the departure day after takeoff or on the arrival day before landing.
//
// This seeds a single overnight Paris → Tokyo flight departing Paris
// afternoon and landing Tokyo the next calendar morning (09:10 JST).

test('a midnight/timezone-crossing Transport leg appears on both its departure and arrival day, with free time correctly split (Bugs DB, Bloquant)', async ({
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
      name: `E2E day-edge arrival tz trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-11',
      currency: 'EUR',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const flightName = `E2E CDG-HND overnight ${runId}`

    // Departs Paris 13:35 CEST (UTC+2) on Sep 10 = 11:35Z. Lands Tokyo (JST,
    // UTC+9, no DST) ~12h35m later = 00:10Z Sep 11 = 09:10 JST Sep 11 — a
    // realistic Paris-Tokyo nonstop duration/schedule.
    const { error: flightError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: flightName,
      start_at: '2026-09-10T11:35:00.000Z',
      start_timezone: 'Europe/Paris',
      end_at: '2026-09-11T00:10:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (flightError) throw flightError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()

    const mobileView = page.getByTestId('mobile-day-view')
    const mobileRailItems = page.locator('main ul').first().locator('li')

    // Departure day (Sep 10): flight shows as a Departure row. Leading free
    // time before it (08:00 -> 13:35 Paris time = 5h 35m) is unaffected by
    // this bug, sanity-checks the day loaded correctly. No free time after
    // departure at all — the traveler remains occupied (in transit) for the
    // rest of the day's window; the real post-arrival free time belongs to
    // the arrival day instead, not here.
    await expect(mobileView.getByText(flightName)).toBeVisible()
    await expect(mobileView.getByText('Departure · 13:35')).toBeVisible()
    await expect(mobileView.getByText('5h 35m free').first()).toBeVisible()
    await expect(mobileView.getByText('12h 50m free')).not.toBeVisible()
    await expect(mobileRailItems).toHaveCount(2)

    // Arrival day (Sep 11): before this fix, the flight never appeared here
    // at all — this tab rendered as one big, wrong, full-day free block from
    // day-start, even though the traveler was still airborne until 09:10
    // JST. It must now show an Arrival row, with no free time before it, and
    // the real trailing free time (09:10 JST arrival -> 22:00 JST, Tokyo's
    // own Sep 11 — not Paris's Sep 10) = 12h 50m after it.
    await page.getByRole('button', { name: 'Sep 11' }).click()
    await expect(mobileView.getByText(flightName)).toBeVisible()
    await expect(mobileView.getByText('Arrival · 09:10')).toBeVisible()
    await expect(mobileView.getByText('12h 50m free')).toBeVisible()
    await expect(mobileRailItems).toHaveCount(2)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
