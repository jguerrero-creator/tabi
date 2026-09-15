import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-24 follow-up (Bug: "Le lieu planifié explicite du jour ne prend pas le dessus sur
// l'hébergement actif..."). resolveContextualLocation used to always prefer the active
// accommodation over an explicit day-level planned location — real-world gap: setting
// "Nikko" as a Tokyo-trip day-trip's planned location had no effect, since the Tokyo
// accommodation was still "active" that night. Priority is now inverted: an explicit
// planned location wins, accommodation is only the fallback when no planned location is
// set for that day. This is asserted via the outgoing /api/places-nearby request body
// (the actual centering point), not the map's own rendering — Playwright's headless
// Chromium can't reliably load the Maps JS SDK here (TABI-162, a known unrelated infra
// gap), so maps.googleapis.com is blocked; that's independent of the centering logic
// under test, which runs regardless of whether the map itself renders.

// The "+" on a free-time block only renders on the single-day rail (below the `lg`
// breakpoint) — see timeline-manual-block.spec.ts's same note.
test.use({ viewport: { width: 390, height: 844 } })

const TOKYO_ACCOMMODATION = { lat: 35.6812, lng: 139.7671 }
const NIKKO_PLANNED_LOCATION = { lat: 36.758, lng: 139.6062 }

test('an explicit day-level planned location overrides active accommodation when centering nearby-places suggestions', async ({
  page,
  registerTrip,
}) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/places-nearby', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', results: [] }) }),
  )

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
      name: `E2E nearby-places centering trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-13',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // Check-in/check-out both well outside the visible trip range, so every visible day
    // (Sep 10-12) is a plain interior night with no Stay occurrence of its own — just a
    // full free block for the whole day window, with this Stay as its active accommodation.
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E Tokyo accommodation ${runId}`,
      start_at: '2026-09-05T15:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-09-20T01:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
      start_address: 'Tokyo Station, Tokyo, Japan',
      start_lat: TOKYO_ACCOMMODATION.lat,
      start_lng: TOKYO_ACCOMMODATION.lng,
      start_place_name: 'Tokyo Station',
      start_city: 'Tokyo',
    })
    if (stayError) throw stayError

    // Explicit planned location on Sep 11 only — a Nikko day-trip within the Tokyo stay.
    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-11',
      place_name: 'Nikko',
      address: 'Nikko, Tochigi, Japan',
      lat: NIKKO_PLANNED_LOCATION.lat,
      lng: NIKKO_PLANNED_LOCATION.lng,
      timezone: 'Asia/Tokyo',
      city: 'Nikko',
    })
    if (dayLocationError) throw dayLocationError

    await page.goto(`/trips/${trip.id}`)
    await page.getByRole('button', { name: 'Planning' }).click()

    // Sep 10 has no explicit planned location — falls back to the active accommodation
    // (regression check: this must keep working after inverting the priority).
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()
    await page.getByRole('button', { name: 'Sep 10' }).click()

    const [sep10Request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/places-nearby') && req.method() === 'POST'),
      page.getByRole('button', { name: 'Add something here' }).click(),
    ])
    const sep10Body = sep10Request.postDataJSON() as { lat: number; lng: number }
    expect(sep10Body.lat).toBeCloseTo(TOKYO_ACCOMMODATION.lat, 3)
    expect(sep10Body.lng).toBeCloseTo(TOKYO_ACCOMMODATION.lng, 3)

    await expect(page.getByRole('heading', { name: 'Nearby places' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Nearby places' })).not.toBeVisible()

    // Sep 11 has an explicit planned location (Nikko) — must now win over the still-active
    // Tokyo accommodation.
    await page.getByRole('button', { name: 'Sep 11' }).click()

    const [sep11Request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/places-nearby') && req.method() === 'POST'),
      page.getByRole('button', { name: 'Add something here' }).click(),
    ])
    const sep11Body = sep11Request.postDataJSON() as { lat: number; lng: number }
    expect(sep11Body.lat).toBeCloseTo(NIKKO_PLANNED_LOCATION.lat, 3)
    expect(sep11Body.lng).toBeCloseTo(NIKKO_PLANNED_LOCATION.lng, 3)
  } finally {
    await client.from('trip_day_locations').delete().eq('trip_id', trip.id)
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

// TABI-24 follow-up (Backlog: "Nearby Places suggestions : ajouter une liste latérale...").
// The suggestion screen used to only show pins on the map, requiring a click on each one
// to see what it was — slow for comparing options. A side list now mirrors the same
// fetched results (name, rating, photo) so they're all visible without clicking anything.
const FIXTURE_PLACES = [
  {
    googlePlaceId: 'ChIJ_fixture_nearby_a',
    name: 'Nikko Toshogu Shrine',
    formattedAddress: '2301 Sannai, Nikko, Tochigi, Japan',
    lat: 36.7581,
    lng: 139.5995,
    rating: 4.6,
    userRatingsTotal: 8000,
    photoRef: null,
    category: 'tourist_attraction',
  },
  {
    googlePlaceId: 'ChIJ_fixture_nearby_b',
    name: 'Nikko Local Ramen',
    formattedAddress: '123 Nikko, Tochigi, Japan',
    lat: 36.75,
    lng: 139.61,
    rating: 4.3,
    userRatingsTotal: 150,
    photoRef: null,
    category: 'restaurant',
  },
]

test('the nearby-places side list shows all suggested results without clicking map pins', async ({
  page,
  registerTrip,
}) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/places-nearby', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', results: FIXTURE_PLACES }),
    }),
  )

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
      name: `E2E nearby-places list trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-12',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E Nikko stay ${runId}`,
      start_at: '2026-09-05T15:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-09-20T01:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
      start_address: 'Nikko, Japan',
      start_lat: NIKKO_PLANNED_LOCATION.lat,
      start_lng: NIKKO_PLANNED_LOCATION.lng,
      start_place_name: 'Nikko',
      start_city: 'Nikko',
    })
    if (stayError) throw stayError

    await page.goto(`/trips/${trip.id}`)
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()
    await page.getByRole('button', { name: 'Sep 10' }).click()

    await page.getByRole('button', { name: 'Add something here' }).click()
    await expect(page.getByRole('heading', { name: 'Nearby places' })).toBeVisible()

    // Both results are visible in the list without clicking any map pin.
    const list = page.getByRole('listbox', { name: 'Suggested places' })
    await expect(list.getByRole('option')).toHaveCount(2)
    await expect(list.getByRole('option', { name: /Nikko Toshogu Shrine/ })).toBeVisible()
    await expect(list.getByRole('option', { name: /Nikko Local Ramen/ })).toBeVisible()
    await expect(list.getByRole('option', { name: /★ 4.6 \(8000\)/ })).toBeVisible()

    // Selecting a list item (not a map pin) surfaces the Add action for that place.
    await list.getByRole('option', { name: /Nikko Local Ramen/ }).click()
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
