import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout — see trip-timeline-day-edge-arrival-timezone.spec.ts's
// identical comment for why.
test.use({ viewport: { width: 390, height: 844 } })

// Bugs DB, Sévérité: Majeur — "Le split Départ/Arrivée inconditionnel fait compter en
// double les Transport sur une même journée". Earlier the same day (2026-08-28),
// buildDayOccurrences's Departure/Arrival split was made fully unconditional to fix a
// separate Bloquant bug (a cross-timezone leg's dates coincidentally matching as
// strings — see trip-timeline-coincidental-timezone-match.spec.ts). That made every
// point-to-point Transport leg split into two occurrences, even an ordinary same-day,
// same-timezone domestic hop (a train, a taxi) — the vast majority of real Transport
// bookings — duplicating it into two rail cards and inflating the day-tab item count
// by one. The split is now conditional again, but on a same-*single*-timezone date
// comparison only (never comparing two different timezones' date strings, which is
// what caused the original bug) — see buildDayOccurrences's own comment for the
// reasoning. This seeds a same-day, same-timezone train and checks it renders as ONE
// card with an accurate item count, exactly as it did before either fix.

test('an ordinary same-day, same-timezone Transport leg renders as one card, not a duplicated Departure/Arrival pair', async ({
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
      name: `E2E same-day transport trip ${runId}`,
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
    const trainName = `E2E Paris-Lyon same-day train ${runId}`

    // Departs Paris 09:00 CEST (UTC+2, September, no ambiguity) = 07:00Z. Arrives
    // Lyon 11:00 CEST, same timezone, same calendar day = 09:00Z.
    const { error: trainError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: trainName,
      start_at: '2026-09-10T07:00:00.000Z',
      start_timezone: 'Europe/Paris',
      end_at: '2026-09-10T09:00:00.000Z',
      end_timezone: 'Europe/Paris',
    })
    if (trainError) throw trainError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()

    // The day pill's item-count badge reads "1 planned item" — not 2 — confirming
    // countDayItems dedupes by reservation id rather than counting raw occurrences.
    await expect(page.getByTitle('1 planned item')).toBeVisible()
    await expect(page.getByTitle('2 planned items')).not.toBeVisible()

    const mobileView = page.getByTestId('mobile-day-view')
    const mobileRailItems = page.locator('main ul').first().locator('li')

    // Exactly one card for this leg — no separate Departure/Arrival split. A
    // single (unsplit) Transport occurrence still labels itself "Departure ·"
    // (its start time) same as always; only a genuine split ever produces a
    // second "Arrival ·" row, which must not appear here.
    await expect(mobileView.getByText(trainName)).toHaveCount(1)
    await expect(mobileView.getByText('Departure · 09:00')).toBeVisible()
    await expect(mobileView.getByText('Arrival · 11:00')).not.toBeVisible()

    // Leading free time (08:00 -> 09:00) + the single reservation card + trailing
    // free time (11:00 -> 22:00 = 11h) = 3 rail entries, same shape as any other
    // ordinary single reservation on a day, no duplication.
    await expect(mobileView.getByText('1h free', { exact: true })).toBeVisible()
    await expect(mobileView.getByText('11h free')).toBeVisible()
    await expect(mobileRailItems).toHaveCount(3)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
