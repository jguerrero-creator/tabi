import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Bugs DB, Sévérité: Majeur — "computeAccommodationGaps ignore les nuits couvertes
// par un Transport". computeAccommodationGaps.ts only ever knew about Stay
// reservations, so a night covered by an overnight flight (no Stay needed that
// night) was wrongly flagged as an uncovered accommodation gap. Fix: a
// point-to-point Transport leg that touches a night at all — even partially,
// e.g. departs 23:00 arrives 02:00 the next day — now suppresses the gap for
// that night, binary (no partial credit), reusing findInProgressTransportLeg.
//
// Seeds one trip covering three scenarios in a single page load (to conserve
// the shared Supabase anonymous-signin rate limit):
//  - Dec 20-21: covered by a Stay.
//  - Dec 22: no Stay, but an overnight flight departs 23:00 Dec 22 and lands
//    02:00 Dec 23 — only partially touches the night. Must be fully suppressed.
//  - Dec 23: no Stay and no Transport at all — a genuine gap, must still show.
//  - Dec 24: covered by a second Stay (isolates the Dec 23 gap to exactly one night).
test('an overnight Transport leg suppresses its accommodation gap, and a real gap still shows', async ({
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
      name: `E2E gap-transport-coverage trip ${runId}`,
      start_date: '2026-12-20',
      end_date: '2026-12-25',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: stayBeforeError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E gap-coverage stay before ${runId}`,
      start_at: '2026-12-20T00:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-12-22T00:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (stayBeforeError) throw stayBeforeError

    const { error: stayAfterError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E gap-coverage stay after ${runId}`,
      start_at: '2026-12-24T00:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-12-25T00:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (stayAfterError) throw stayAfterError

    // Departs 23:00 UTC Dec 22, arrives 02:00 UTC Dec 23 — only partially touches
    // the night of Dec 22, and must still fully suppress that night's gap.
    const legName = `E2E gap-coverage overnight flight ${runId}`
    const { error: legError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: legName,
      start_at: '2026-12-22T23:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-12-23T02:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (legError) throw legError

    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    // Exactly one gap total: the genuine one (Dec 23, no Stay and no Transport).
    // The overnight-flight-covered night (Dec 22) must not appear as a gap at all.
    await expect(page.getByRole('heading', { name: 'Not booked', exact: false })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Not booked · Wed, Dec 23 → Thu, Dec 24' })).toBeVisible()
    await expect(page.getByText('1 night not booked')).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
