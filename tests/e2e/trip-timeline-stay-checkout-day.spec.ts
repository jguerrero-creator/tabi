import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout — see trip-timeline-day-edge-arrival-timezone.spec.ts
// for why (Planning toggle button is lg:hidden on desktop).
test.use({ viewport: { width: 390, height: 844 } })

// A multi-night Stay was only ever bucketed under its check-in day
// (`groupByDate` grouped purely on `start_at`), so the check-out never got
// its own rail row: the check-in day's trailing free-time block was computed
// from the real checkout instant (correctly, timezone-wise) but filed under
// the check-in day, and the check-out day itself rendered as fully free from
// day-start to day-end with no acknowledgment a check-out ever happened.
// `buildDayOccurrences` (TripTimeline.tsx) now expands a multi-night Stay
// into two occurrences — check-in day and check-out day — each getting its
// own correctly-split leading/trailing free time.

test('a multi-night Stay shows a Check-out row and correctly split free time on its own checkout day', async ({
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
      name: `E2E stay checkout day trip ${runId}`,
      start_date: '2026-07-29',
      end_date: '2026-07-31',
      currency: 'EUR',
      day_start_time: '10:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const stayName = `E2E stay checkout ${runId}`

    // Check-in 2026-07-29 18:07, check-out 2026-07-30 17:08 — same instants
    // as the reported bug (a 1-night stay spanning two calendar days).
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: stayName,
      start_at: '2026-07-29T16:07:00.000Z',
      start_timezone: 'Europe/Paris',
      end_at: '2026-07-30T15:08:00.000Z',
      end_timezone: 'Europe/Paris',
    })
    if (stayError) throw stayError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Jul 29' })).toBeVisible()

    const mobileView = page.getByTestId('mobile-day-view')

    // Check-in day (Jul 29): free until check-in, then Check-in, then free
    // until day-end *that same day* — must not swallow the next day's
    // checkout free time.
    await expect(mobileView.getByText(stayName)).toBeVisible()
    await expect(mobileView.getByText('Check-in · 18:07')).toBeVisible()
    await expect(mobileView.getByText('8h 7m free').first()).toBeVisible()
    await expect(mobileView.getByText('3h 53m free').first()).toBeVisible()

    // Switch to check-out day (Jul 30): a Check-out row must appear, with
    // free time correctly split before and after it.
    await page.getByRole('button', { name: 'Jul 30' }).click()
    await expect(mobileView.getByText(stayName)).toBeVisible()
    await expect(mobileView.getByText('Check-out · 17:08')).toBeVisible()
    await expect(mobileView.getByText('7h 8m free').first()).toBeVisible()
    await expect(mobileView.getByText('4h 52m free').first()).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
