import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout — DayTabs (and its jetlag badge) only renders in
// the mobile single-day view; the desktop carousel shows every day's column
// at once with no day-tab pills at all.
test.use({ viewport: { width: 390, height: 844 } })

// TABI-66 — a Transport leg's arrival day is flagged "probable jetlag" when
// the departure/arrival timezone offsets differ by 3+ hours, purely as a
// day-tab visual cue (never fed into freeTimeBlocks.ts). Covers both the
// positive case (Brussels → Tokyo, ~8h offset diff) and the negative case
// (Brussels → Rome, same CET/CEST offset, 0h diff) in one anonymous session
// to stay under Supabase's anon sign-in rate limit.
test('flags a long-haul arrival day with jetlag but not a same-offset short-haul one', async ({
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
      name: `E2E jetlag indicator trip ${runId}`,
      start_date: '2026-11-10',
      end_date: '2026-11-11',
      currency: 'EUR',
      day_start_time: '07:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: legError } = await client.from('reservations').insert([
      {
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        status: 'booked',
        name: `E2E Brussels-Tokyo leg ${runId}`,
        start_at: '2026-11-10T01:00:00.000Z',
        start_timezone: 'Europe/Brussels',
        end_at: '2026-11-10T05:00:00.000Z',
        end_timezone: 'Asia/Tokyo',
      },
      {
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        status: 'booked',
        name: `E2E Brussels-Rome leg ${runId}`,
        start_at: '2026-11-11T09:00:00.000Z',
        start_timezone: 'Europe/Brussels',
        end_at: '2026-11-11T11:00:00.000Z',
        end_timezone: 'Europe/Rome',
      },
    ])
    if (legError) throw legError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    const longHaulArrivalPill = page.getByRole('button', { name: 'Nov 10' })
    await expect(longHaulArrivalPill).toBeVisible()
    await expect(longHaulArrivalPill.getByTitle('Probable jetlag day')).toBeVisible()

    const shortHaulArrivalPill = page.getByRole('button', { name: 'Nov 11' })
    await expect(shortHaulArrivalPill).toBeVisible()
    await expect(shortHaulArrivalPill.getByTitle('Probable jetlag day')).toHaveCount(0)

    // Free-time engine must be completely unaffected by the jetlag lookup.
    await longHaulArrivalPill.click()
    await expect(page.getByText(/free$/).first()).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
