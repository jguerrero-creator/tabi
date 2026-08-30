import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Forces the mobile layout — DayTabs (and its vehicle-rental badge) only
// renders in the mobile single-day view; the desktop carousel shows every
// day's column at once with no day-tab pills at all.
test.use({ viewport: { width: 390, height: 844 } })

// Bugs DB, Sévérité: Majeur — "findActiveVehicleRental inverse sa propre plage
// de dates à travers des fuseaux horaires éloignés". findActiveVehicleRental
// used to compare `pickup`/`dropoff` as local calendar-date *strings*, each
// computed in its own (potentially very different) timezone. When the two
// zones are far enough apart, the drop-off's local date string can read
// lexicographically *earlier* than the pickup's even though the drop-off
// instant is strictly later in real time — inverting the range so it matched
// no date at all, including the rental's own pickup/drop-off day.
//
// This seeds a 1-hour at-disposal rental picked up in Pacific/Auckland
// (UTC+13, NZDT in November) and dropped off in Pacific/Niue (UTC-11): the
// pickup instant (2026-11-10T12:00Z) displays as "Nov 11, 01:00" Auckland
// local, while the drop-off instant one hour later (2026-11-10T13:00Z)
// displays as "Nov 10, 02:00" Niue local — the drop-off's own local date
// string ("2026-11-10") reads *before* the pickup's ("2026-11-11"), despite
// being the later real instant. The old string-comparison code treated this
// as an empty/inverted range and never showed the rental as active anywhere.

test('an at-disposal rental whose pickup/drop-off timezones invert local date strings still shows as active', async ({
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
      name: `E2E rental tz inversion trip ${runId}`,
      start_date: '2026-11-10',
      end_date: '2026-11-10',
      currency: 'NZD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const rentalName = `E2E Auckland-Niue rental ${runId}`

    const { error: rentalError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'at_disposal',
      status: 'booked',
      name: rentalName,
      start_at: '2026-11-10T12:00:00.000Z',
      start_timezone: 'Pacific/Auckland',
      end_at: '2026-11-10T13:00:00.000Z',
      end_timezone: 'Pacific/Niue',
    })
    if (rentalError) throw rentalError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    // The rental's own day pill must carry the vehicle-rental badge — the
    // inverted-range bug made this title never appear for any date.
    const dayPill = page.getByRole('button', { name: 'Nov 10' })
    await expect(dayPill).toBeVisible()
    await expect(dayPill.getByTitle('Vehicle rental: Booked')).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
