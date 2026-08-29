import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-172 — the "Planning" nav button is lg:hidden on the desktop layout
// (TABI-149), so it's only reachable at a mobile viewport.
test.use({ viewport: { width: 390, height: 844 } })

// TABI-3/4/13 — the Planning tab shows one day at a time via day-tab pills
// (matches the product wireframe), with a vertical rail threading each day's
// reservations and free-time/travel blocks together. The free/travel block
// between two consecutive reservations must still show even when the second
// one's start_at falls on a different calendar day than the first — e.g. a
// multi-night Stay's checkout followed, a few hours later the same day, by a
// Transport departure. It must also show réservé/trajet/libre as visually
// distinct states, not a single merged "free" row.
//
// A multi-night Stay now gets its own Check-out occurrence on its check-out
// day (TABI-112 follow-up — `buildDayOccurrences` in TripTimeline.tsx), so
// the 3h gap between checkout and the Transport departure correctly renders
// on Sep 12 right after the Check-out row, not smeared onto Sep 10 after
// Check-in (the Check-in day's own trailing free time now stops at that same
// day's own window end instead).

test('Planning shows one day at a time via day-tabs, with a cross-day free/travel block correctly placed', async ({
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
    .insert({ organizer_id: user.id, name: `E2E timeline trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const stayName = `E2E timeline stay ${runId}`
    const transportName = `E2E timeline transport ${runId}`

    // Check-in Sep 10, check-out Sep 12 — grouped under "Sep 10" by start_at.
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: stayName,
      start_at: '2026-09-10T06:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      start_lat: 35.6595,
      start_lng: 139.7005, // Shibuya Station
      end_at: '2026-09-12T02:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (stayError) throw stayError

    // Departs Sep 12, 3h after checkout — grouped under "Sep 12", a *different*
    // day-group than the Stay it directly follows.
    const { error: transportError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: transportName,
      start_at: '2026-09-12T05:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      start_lat: 35.5494,
      start_lng: 139.7798, // Haneda Airport
      end_at: '2026-09-12T06:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (transportError) throw transportError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    // Defaults to the first day; both day-tab pills exist.
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sep 12' })).toBeVisible()

    // Scoped to the mobile single-day view (data-testid="mobile-day-view") —
    // the desktop multi-day carousel (TABI-149) renders every day's rail at
    // once too, just CSS-hidden at this viewport, so an unscoped locator
    // matches both copies and fails Playwright's strict mode (TABI-172 follow-up).
    const mobileView = page.getByTestId('mobile-day-view')
    await expect(mobileView.getByText('Local time:')).toBeVisible()

    const stayRow = mobileView.locator('li').filter({ hasText: stayName }).filter({ hasText: 'Check-in' })
    await expect(stayRow).toBeVisible()
    // Only the selected day's reservations are shown.
    await expect(mobileView.locator('li').filter({ hasText: transportName })).toHaveCount(0)

    // Check-in day's own trailing free time runs to *that day's* window end
    // (22:00 JST) — it must not swallow the checkout day's free time too.
    const checkInTrailingFreeRow = stayRow.locator('xpath=following-sibling::li[1]')
    await expect(checkInTrailingFreeRow).toContainText('free')
    await expect(checkInTrailingFreeRow).toContainText('7h')

    // Switching day-tabs shows Sep 12's own occurrence of the Stay (its
    // Check-out row) plus the Transport — which stays a single row here (same
    // timezone, same local date both ends) rather than splitting into a
    // Departure/Arrival pair; only a leg that actually spans more than one
    // local calendar date does that (Bugs DB, Majeur — "Le split
    // Départ/Arrivée inconditionnel fait compter en double les Transport sur
    // une même journée").
    await page.getByRole('button', { name: 'Sep 12' }).click()
    await expect(mobileView.locator('li').filter({ hasText: transportName })).toBeVisible()

    // A free block is attached right after the Check-out row, on the
    // checkout's own day (Sep 12) — not dropped because the Transport it
    // connects to starts later the same day. It spans the real 3h gap to the
    // Transport's departure (11:00 → 14:00 JST), not the day-window's generic
    // trailing edge: this leg has no user-picked transport mode yet (TABI-154
    // made mode a manual choice), but a gap must never render as silence, so
    // it shows as a plain free block with no travel time subtracted rather
    // than being skipped.
    const checkOutRow = mobileView.locator('li').filter({ hasText: stayName }).filter({ hasText: 'Check-out' })
    await expect(checkOutRow).toBeVisible()
    const freeRow = checkOutRow.locator('xpath=following-sibling::li[1]')
    await expect(freeRow).toContainText('free')
    await expect(freeRow).toContainText('3h')

    await page.screenshot({ path: 'test-results/planning-timeline-visual.png', fullPage: true })
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
