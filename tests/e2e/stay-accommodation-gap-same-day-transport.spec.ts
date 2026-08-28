import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Bugs DB, Sévérité: Majeur — "computeAccommodationGaps sous-compte les nuits
// manquantes". TABI's transportTouchesNight suppression (added alongside the
// overnight-flight fix) matched ANY Transport leg departing on a calendar day,
// regardless of what time it departed or whether it ever crossed midnight. A
// same-day daytime leg (e.g. an 11:00-13:00 train) was wrongly treated the same
// as a genuine overnight leg, silently swallowing that night's gap. Real-world
// case: a Sendai -> Tokyo daytime train on Jan 7 made the Jan 7 night vanish
// from the gap range entirely, undercounting a real 2-night gap (Jan 7 + Jan 8)
// down to 1 (Jan 8 only). Fix: only suppress when the leg's arrival is on a
// later calendar day than its departure (a true overnight crossing).
//
// Seeds one trip:
//  - Jan 1-3: covered by a Stay.
//  - Jan 3: a same-day daytime train (11:00-13:00) — must NOT suppress the gap.
//  - Jan 3 and Jan 4: no Stay at all in between — a genuine 2-night gap.
//  - Jan 5: covered by a second Stay (isolates the gap to exactly Jan 3 + Jan 4).
test('a same-day daytime Transport leg does not suppress a genuine accommodation gap', async ({
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
      name: `E2E gap-same-day-transport trip ${runId}`,
      start_date: '2026-01-01',
      end_date: '2026-01-06',
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
      name: `E2E gap-same-day stay before ${runId}`,
      start_at: '2026-01-01T00:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-01-03T00:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (stayBeforeError) throw stayBeforeError

    const { error: stayAfterError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E gap-same-day stay after ${runId}`,
      start_at: '2026-01-05T00:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-01-06T00:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (stayAfterError) throw stayAfterError

    // Departs 11:00 UTC, arrives 13:00 UTC same calendar day — a daytime leg that
    // never touches nighttime hours and must not suppress either Jan 3 or Jan 4.
    const legName = `E2E gap-same-day daytime train ${runId}`
    const { error: legError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: legName,
      start_at: '2026-01-03T11:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-01-03T13:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (legError) throw legError

    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    // Exactly one gap: the genuine 2-night one (Jan 3 + Jan 4), not split or shrunk.
    await expect(page.getByRole('heading', { name: 'Not booked', exact: false })).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Not booked · Sat, Jan 3 → Mon, Jan 5' })).toBeVisible()
    await expect(page.getByText('2 nights not booked')).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
