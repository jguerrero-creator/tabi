import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Bugs DB: "centerOf(points) calcule probablement une moyenne naïve lat/lng" (Majeur).
// Originally: a naive lat/lng average of Tokyo + Brussels (~9700km apart) landed in
// rural Kazakhstan — fixed via fitBounds(mapCameraFor).
//
// Follow-up product decision: fitBounds across *every* point isn't right either once
// a trip includes a long-haul flight — the chronologically-first point is presumed to
// be where the traveler lives, not a destination worth framing the map around. Overview
// maps now use `pointsForCamera()` to skip past the first long-haul jump (>= 3000km)
// and frame the trip from the first post-flight destination onward. This test uses the
// same Tokyo + Brussels pair, but now Tokyo (chronologically first = "home") is expected
// to fall OUTSIDE the framed viewport, while Brussels (the destination reached after the
// long flight) must be inside it.

function reservation(tripId: string, name: string, lat: number, lng: number, startAt: string, endAt: string) {
  return {
    trip_id: tripId,
    type: 'stay',
    stay_subtype: 'hotel',
    status: 'booked',
    name: `far-apart-${name}`,
    start_at: startAt,
    start_timezone: 'UTC',
    end_at: endAt,
    end_timezone: 'UTC',
    start_lat: lat,
    start_lng: lng,
    start_place_name: name,
  }
}

// Google's marker overlay reports a hidden marker's boundingBox() at its last
// laid-out (often stale) position rather than zeroing it out — visibility is
// the signal that actually reflects whether the marker is inside the current
// viewport, not the geometry.

test('Overview map skips the pre-flight "home" point and frames the post-flight destination (Tokyo -> Brussels)', async ({
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
    .insert({ organizer_id: user.id, name: `E2E far-apart trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // Distinct dates (not the same day) so the chronological order buildMapPoints
    // relies on is deterministic, not dependent on same-day row return order.
    const { error: reservationError } = await client.from('reservations').insert([
      reservation(trip.id, 'Tokyo', 35.6762, 139.6503, '2026-09-10T06:00:00.000Z', '2026-09-12T06:00:00.000Z'),
      reservation(trip.id, 'Brussels', 50.8503, 4.3517, '2026-09-15T06:00:00.000Z', '2026-09-17T06:00:00.000Z'),
    ])
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    // Normal (MiniMap) view: Brussels framed, Tokyo ("home") must NOT be.
    const normalMap = page.getByTestId('map').first()
    await expect(normalMap).toBeVisible()
    await expect(normalMap.getByTitle('Brussels')).toBeVisible()
    await expect(normalMap.getByTitle('Tokyo')).not.toBeVisible()

    // Fullscreen view — MiniMap stays mounted underneath, so marker lookups must
    // be scoped to this container or "Tokyo"/"Brussels" would match twice.
    await page.getByRole('button', { name: 'Expand map' }).click()
    const fullscreenMap = page.locator('.fixed.inset-0.z-50')
    await expect(fullscreenMap).toBeVisible()
    await expect(fullscreenMap.getByTitle('Brussels')).toBeVisible()
    await expect(fullscreenMap.getByTitle('Tokyo')).not.toBeVisible()
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

// Bugs DB follow-up: a round trip (Brussels -> Tokyo -> Brussels) still showed the
// whole map, because the original fix only trimmed the *prefix* before the first
// long-haul jump — a later return-to-home point survived the trim and dragged
// fitBounds back out to frame both continents. pointsForCamera() now excludes any
// point near home by proximity, wherever it falls in the sequence.
test('Overview map excludes home even when it recurs (round trip: Brussels -> Tokyo -> Brussels)', async ({
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
    .insert({ organizer_id: user.id, name: `E2E round-trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert([
      reservation(trip.id, 'Brussels-depart', 50.8503, 4.3517, '2026-09-08T06:00:00.000Z', '2026-09-08T08:00:00.000Z'),
      reservation(trip.id, 'Tokyo', 35.6762, 139.6503, '2026-09-10T06:00:00.000Z', '2026-09-15T06:00:00.000Z'),
      reservation(trip.id, 'Brussels-return', 50.8503, 4.3517, '2026-09-17T06:00:00.000Z', '2026-09-17T08:00:00.000Z'),
    ])
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    const normalMap = page.getByTestId('map').first()
    await expect(normalMap).toBeVisible()
    await expect(normalMap.getByTitle('Tokyo')).toBeVisible()
    await expect(normalMap.getByTitle('Brussels-depart')).not.toBeVisible()
    await expect(normalMap.getByTitle('Brussels-return')).not.toBeVisible()
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

test('Overview map still frames both points when no long-haul flight is involved (Tokyo -> Kyoto)', async ({
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
    .insert({ organizer_id: user.id, name: `E2E nearby trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert([
      reservation(trip.id, 'Tokyo', 35.6595, 139.7005, '2026-09-10T06:00:00.000Z', '2026-09-12T06:00:00.000Z'),
      reservation(trip.id, 'Kyoto', 35.0116, 135.7681, '2026-09-13T06:00:00.000Z', '2026-09-15T06:00:00.000Z'),
    ])
    if (reservationError) throw reservationError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Trip' })).toBeVisible()

    const normalMap = page.getByTestId('map').first()
    await expect(normalMap).toBeVisible()
    await expect(normalMap.getByTitle('Tokyo')).toBeVisible()
    await expect(normalMap.getByTitle('Kyoto')).toBeVisible()
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
