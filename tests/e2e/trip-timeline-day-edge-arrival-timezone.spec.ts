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
// This seeds a single overnight Paris → Tokyo flight (the day's only item, so
// items[0] === last) departing Paris afternoon and landing Tokyo the next
// calendar morning (09:10 JST). With the fix, the trailing free block should
// run from that arrival to 22:00 JST on the *arrival's own* calendar date
// (Sep 11 in Tokyo) — 12h 50m — rather than disappearing entirely (the old
// bug: 22:00 Paris time on the *departure's* Sep 10 falls before the arrival
// instant, producing a negative duration that got silently dropped).

test('trailing free block after an international arrival uses the arrival timezone, not the departure timezone (TABI-165)', async ({
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

    // Both a mobile single-day view and a desktop carousel render
    // simultaneously in the DOM (CSS-toggled visibility), hence `.first()`
    // throughout.
    await expect(page.getByRole('link', { name: flightName, exact: false }).first()).toBeVisible()

    // Leading edge (08:00 -> 13:35 Paris time) — unaffected by this bug,
    // sanity-checks the day loaded correctly.
    await expect(page.getByText('5h 35m free').first()).toBeVisible()

    // Trailing edge: 09:10 JST arrival -> 22:00 JST (Tokyo's own Sep 11,
    // not Paris's Sep 10) = 12h 50m. Before the fix this block didn't render
    // at all (negative duration, silently dropped).
    await expect(page.getByText('12h 50m free').first()).toBeVisible()

    const mobileRailItems = page.locator('main ul').first().locator('li')
    await expect(mobileRailItems).toHaveCount(3)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
