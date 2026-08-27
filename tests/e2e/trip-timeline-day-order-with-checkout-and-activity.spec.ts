import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout — see trip-timeline-day-edge-arrival-timezone.spec.ts
// for why (Planning toggle button is lg:hidden on desktop).
test.use({ viewport: { width: 390, height: 844 } })

// Bugs DB, "Ordre chronologique cassé dans la timeline d'un jour" (Sévérité:
// Majeur). A day with an Activity, a Stay check-out, and a Transport
// departure rendered the check-out row *after* a free-time block that was
// actually timed later than the check-out itself. Root cause: the pairwise
// free-time/leg engines (`computeFreeTimeBlocks`, `buildTripLegs`) sorted the
// *raw* reservation list by each reservation's own `start_at` — a multi-night
// Stay's check-in instant, not its real check-out instant — so a reservation
// (the Activity) landing chronologically between check-in and check-out
// absorbed the "next" slot in that sort, and the entire gap from the
// Activity's end straight through to the following Transport's departure got
// attributed to the Activity instead of to the check-out. `buildDayOccurrences`
// itself (which drives day-grouping and rail ordering) was already correct —
// the bug was specifically in these two sibling pairwise engines not being
// occurrence-aware the same way.

test('a day with an Activity, a Stay check-out, and a Transport departure renders all three in true chronological order', async ({
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
      name: `E2E day-order trip ${runId}`,
      start_date: '2026-02-09',
      end_date: '2026-02-10',
      currency: 'EUR',
      day_start_time: '07:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const stayName = `E2E ryokan ${runId}`
    const activityName = `E2E ski ${runId}`
    const transportName = `E2E onsen bus ${runId}`

    // Check-in Feb 9 15:00 JST, check-out Feb 10 10:00 JST.
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'ryokan',
      status: 'booked',
      name: stayName,
      start_at: '2026-02-09T06:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-02-10T01:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (stayError) throw stayError

    // Feb 10, 08:00-09:00 JST — starts on the check-out day, before the
    // 10:00 JST check-out.
    const { error: activityError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'activity',
      status: 'booked',
      name: activityName,
      start_at: '2026-02-09T23:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-02-10T00:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (activityError) throw activityError

    // Departs Feb 10, 18:09 JST — after the check-out.
    const { error: transportError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: transportName,
      start_at: '2026-02-10T09:09:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-02-10T11:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (transportError) throw transportError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await page.getByRole('button', { name: 'Feb 10' }).click()

    const mobileView = page.getByTestId('mobile-day-view')
    const activityRow = mobileView.locator('li').filter({ hasText: activityName })
    const checkOutRow = mobileView.locator('li').filter({ hasText: stayName }).filter({ hasText: 'Check-out' })
    const transportRow = mobileView.locator('li').filter({ hasText: transportName })

    await expect(activityRow).toBeVisible()
    await expect(checkOutRow).toBeVisible()
    await expect(transportRow).toBeVisible()

    // True chronological order: Activity (08:00) -> free -> Check-out (10:00)
    // -> free -> Transport (18:09). The Activity's own free block must land
    // between the Activity and the Check-out, not swallow the Check-out's own
    // gap to the Transport.
    const afterActivity = activityRow.locator('xpath=following-sibling::li[1]')
    await expect(afterActivity).toContainText('free')
    await expect(afterActivity).toContainText('1h')

    const afterActivityFree = afterActivity.locator('xpath=following-sibling::li[1]')
    await expect(afterActivityFree).toContainText(stayName)
    await expect(afterActivityFree).toContainText('Check-out')

    const afterCheckOut = checkOutRow.locator('xpath=following-sibling::li[1]')
    await expect(afterCheckOut).toContainText('free')
    await expect(afterCheckOut).toContainText('8h')

    const afterCheckOutFree = afterCheckOut.locator('xpath=following-sibling::li[1]')
    await expect(afterCheckOutFree).toContainText(transportName)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
