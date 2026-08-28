import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Two independent Transport-specific confirmation-dialog fixes, both from the same
// session, exercised against one trip/sign-in to stay under the anon sign-in rate limit.
//
// 1) outOfPeriodField's 'start' comparison used to treat trip.end_date as an exclusive
//    bound (`startKey >= trip.end_date`), asymmetric with the 'end' comparison
//    (`endKey > trip.end_date`) — even though trip.end_date is stored as the trip's
//    literal, inclusive last day (TripFormModal saves the date picker value as-is).
//    A Transport leg whose departure lands exactly on the trip's last day (e.g. flying
//    home) was wrongly flagged "Outside trip dates". A same-day, cross-timezone leg
//    (Tokyo departure, Brussels arrival) surfaces this because both ends resolve to
//    the same local calendar date, which can equal trip.end_date.
// 2) The "Different city than planned" check (TABI-116) is structurally invalid for
//    Transport — a journey changing city is the point, not a mismatch — so it must
//    never fire for Transport, while still firing for Stay/Activity (Decision Log).

test('Transport: same-day cross-timezone leg on the trip boundary is never "outside", and never checked against planned city', async ({
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
    .insert({
      organizer_id: user.id,
      name: `E2E transport dialogs trip ${runId}`,
      start_date: '2027-03-01',
      end_date: '2027-03-09',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // Seed a planned location for 2027-03-06 that differs from anywhere the Tokyo/Brussels
    // reservations below touch, so the (unrelated) location-mismatch checks below have
    // something concrete to compare against.
    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2027-03-06',
      place_name: 'Paris',
      address: 'Paris, France',
      lat: 48.8566,
      lng: 2.3522,
      timezone: 'Europe/Paris',
      city: 'Paris',
    })
    if (dayLocationError) throw dayLocationError

    await page.goto(`/trips/${trip.id}/transport`)
    await expect(page.getByRole('heading', { name: 'Transport' })).toBeVisible()

    // --- Item 1a: same-day cross-timezone leg departing exactly on trip.end_date (2027-03-09)
    // never triggers "Outside trip dates" ---
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Departure address').fill('Tokyo Station, Tokyo, Japan')
    await page.getByLabel('Arrival address').fill('Brussels Airport, Zaventem, Belgium')
    await page.getByLabel('Start date').fill('2027-03-09')
    await page.getByLabel('Start time').fill('08:00')
    await page.getByLabel('End date').fill('2027-03-09')
    await page.getByLabel('End time').fill('13:00')

    const [boundaryLegResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    // No "Outside trip dates" confirm — the leg saves straight through.
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    expect(boundaryLegResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    const { data: boundaryLegRows, error: boundaryLegFetchError } = await client
      .from('reservations')
      .select('start_at, start_timezone, end_at, end_timezone')
      .eq('trip_id', trip.id)
    if (boundaryLegFetchError) throw boundaryLegFetchError
    expect(boundaryLegRows?.length).toBe(1)
    const boundaryLeg = boundaryLegRows![0]
    expect(boundaryLeg.start_timezone).toBe('Asia/Tokyo')
    expect(boundaryLeg.end_timezone).toBe('Europe/Brussels')

    // --- Item 1b (regression): a leg starting the day AFTER the trip's end still triggers
    // "Outside trip dates" — the fix must not have suppressed the check entirely ---
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Departure address').fill('Tokyo Station, Tokyo, Japan')
    await page.getByLabel('Arrival address').fill('Osaka Station, Osaka, Japan')
    await page.getByLabel('Start date').fill('2027-03-10')
    await page.getByLabel('Start time').fill('09:00')
    await page.getByLabel('End date').fill('2027-03-10')
    await page.getByLabel('End time').fill('12:30')

    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    // Cancel out without saving this one — only the boundary check itself is under test.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    // --- Item 2a: a Transport leg whose arrival city differs from 2027-03-06's planned
    // "Paris" is never checked against it — no "Different city than planned" dialog ---
    await page.goto(`/trips/${trip.id}/transport`)
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Departure address').fill('Tokyo Station, Tokyo, Japan')
    await page.getByLabel('Arrival address').fill('Brussels Airport, Zaventem, Belgium')
    await page.getByLabel('Start date').fill('2027-03-06')
    await page.getByLabel('Start time').fill('08:00')
    await page.getByLabel('End date').fill('2027-03-06')
    await page.getByLabel('End time').fill('13:00')

    const [transportMismatchLegResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    await expect(page.getByRole('heading', { name: 'Different city than planned' })).toHaveCount(0)
    expect(transportMismatchLegResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    // --- Item 2b (regression): a Stay whose city differs from the same day's planned "Paris"
    // still triggers "Different city than planned" — the guard must be Transport-only ---
    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Name').fill(`E2E mismatch stay ${runId}`)
    await page.getByLabel('Address').fill('Tokyo Tower, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2027-03-06')
    await page.getByLabel('Nights').fill('1')

    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Different city than planned' })).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Different city than planned' })).toHaveCount(0)
  } finally {
    const { error: deleteDayLocationsError } = await client.from('trip_day_locations').delete().eq('trip_id', trip.id)
    if (deleteDayLocationsError) throw deleteDayLocationsError
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
