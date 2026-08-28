import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout — see trip-timeline-day-edge-arrival-timezone.spec.ts's
// identical comment for why.
test.use({ viewport: { width: 390, height: 844 } })

// Bugs DB, Sévérité: Bloquant — "Comparaison de dates locales dans des fuseaux
// différents peut coïncider par erreur". buildDayOccurrences used to only split a
// point-to-point Transport leg into departure/arrival occurrences when
// localDateKey(start, start_timezone) !== localDateKey(end, end_timezone) — but
// comparing local calendar-date *strings* computed in two DIFFERENT timezones is
// invalid: it can coincidentally match even when the real elapsed time is close to
// a full day. This leg departs Haneda (Asia/Tokyo, UTC+9) 10:00 and lands Brussels
// (Europe/Brussels, UTC+1 in November) ~14h later at 16:00 — both zones' local
// calendar date happens to read the same string, so the old code left it as a
// single, unsplit occurrence. The resulting single trailing free block was computed
// from the *arrival* instant (16:00 Brussels) to that day's own window end (22:00),
// a real 6h — but rendered as if it started right after the 10:00 departure, silently
// claiming the traveler was free for most of a 14h flight. buildDayOccurrences now
// splits every point-to-point leg unconditionally, regardless of what any per-zone
// date-string comparison says, so nothing renders between departure and arrival
// (the traveler is in transit, never "free") and the real 6h shows up after arrival.

test('a long-haul leg whose departure/arrival local dates coincidentally match across timezones still splits, with no bogus free time during the flight', async ({
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
      name: `E2E coincidental tz match trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'EUR',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const flightName = `E2E HND-BRU coincidental match ${runId}`

    // Departs Haneda 10:00 JST (UTC+9) = 01:00Z. Lands Brussels 16:00 CET (UTC+1,
    // November — no DST) = 15:00Z, ~14h later. Both zones' own local calendar date
    // for their respective instant read "Nov 10" — a genuine coincidence, not a bug
    // in either conversion — which is exactly what the old string-equality gate
    // wrongly treated as "same day, no split needed".
    const { error: flightError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: flightName,
      start_at: '2026-11-10T01:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-11-10T15:00:00.000Z',
      end_timezone: 'Europe/Brussels',
    })
    if (flightError) throw flightError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Nov 10' })).toBeVisible()

    const mobileView = page.getByTestId('mobile-day-view')
    const mobileRailItems = page.locator('main ul').first().locator('li')

    // The leg now legitimately renders twice on this one day — a Departure card
    // and an Arrival card, both for the same underlying reservation.
    await expect(mobileView.getByText(flightName)).toHaveCount(2)
    const departureRow = mobileView.locator('li').filter({ hasText: 'Departure · 10:00' })
    const arrivalRow = mobileView.locator('li').filter({ hasText: 'Arrival · 16:00' })
    await expect(departureRow).toBeVisible()
    await expect(arrivalRow).toBeVisible()

    // Nothing renders between departure and arrival — no free block claims the
    // traveler is free during the ~14h flight. The arrival row is the very next
    // sibling after departure, not a "6h free" (or any) block.
    const rowAfterDeparture = departureRow.locator('xpath=following-sibling::li[1]')
    await expect(rowAfterDeparture).toContainText('Arrival · 16:00')
    await expect(rowAfterDeparture).not.toContainText('free')

    // The real post-arrival free time (16:00 -> 22:00 day-end, Brussels) = 6h,
    // correctly attributed *after* arrival, not immediately after departure.
    const rowAfterArrival = arrivalRow.locator('xpath=following-sibling::li[1]')
    await expect(rowAfterArrival).toContainText('free')
    await expect(rowAfterArrival).toContainText('6h')

    // Leading free time before departure (08:00 -> 10:00 JST) = 2h, unaffected by
    // this bug — sanity-checks the day loaded correctly and only one such block exists.
    await expect(mobileView.getByText('2h free')).toBeVisible()
    await expect(mobileRailItems).toHaveCount(4)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
