import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-124 — "Location de véhicule: jours couverts suivent les lieux
// planifiés/hébergement". Spec: during days covered by an at-disposal vehicle
// rental, don't compute a direct pickup -> drop-off route (it isn't a
// straight line) — use that day's planned location (or active
// accommodation) to place the traveler instead. Seeds a multi-day car rental
// (Tokyo pickup -> Osaka drop-off) with an Activity scheduled mid-rental, plus
// a planned location for that day (Kyoto). Asserts the travel-time lookup for
// the (rental -> activity) leg uses the day's planned location as its origin,
// not the rental's drop-off coordinates.

const TOKYO_STATION = { lat: 35.681236, lng: 139.767125 }
const OSAKA_STATION = { lat: 34.702485, lng: 135.495951 }
const KYOTO_STATION = { lat: 34.985849, lng: 135.758767 }
const NARA_PARK = { lat: 34.688643, lng: 135.840406 }

test('an at-disposal rental leg to a mid-rental activity uses the day planned location, not drop-off', async ({
  page,
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
      name: `E2E at-disposal covered-days trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-15',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  const activityName = `E2E mid-rental activity ${runId}`

  try {
    const { error: reservationsError } = await client.from('reservations').insert([
      {
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'at_disposal',
        name: `E2E car rental ${runId}`,
        start_at: '2026-09-10T00:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        start_lat: TOKYO_STATION.lat,
        start_lng: TOKYO_STATION.lng,
        end_at: '2026-09-14T00:00:00.000Z',
        end_timezone: 'Asia/Tokyo',
        end_lat: OSAKA_STATION.lat,
        end_lng: OSAKA_STATION.lng,
      },
      {
        trip_id: trip.id,
        type: 'activity',
        name: activityName,
        start_at: '2026-09-12T05:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        start_lat: NARA_PARK.lat,
        start_lng: NARA_PARK.lng,
        end_at: null,
      },
    ])
    if (reservationsError) throw reservationsError

    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-12',
      place_name: 'Kyoto Station',
      address: null,
      lat: KYOTO_STATION.lat,
      lng: KYOTO_STATION.lng,
      timezone: 'Asia/Tokyo',
    })
    if (dayLocationError) throw dayLocationError

    const travelTimeRequests: { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }[] =
      []
    page.on('requestfinished', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/travel-time')) {
        travelTimeRequests.push(request.postDataJSON())
      }
    })

    await page.goto(`/trips/${trip.id}?tab=planning`)
    await expect(page.getByText(activityName).first()).toBeVisible()

    await expect.poll(() => travelTimeRequests.length, { timeout: 15000 }).toBeGreaterThan(0)

    // Exactly one reservation pair exists chronologically (rental -> activity), and
    // the activity falls before the rental's drop-off — this is the covered-day leg
    // under test. React StrictMode double-invokes effects in dev, so the same lookup
    // may fire twice — assert every request seen matches, not an exact count.
    for (const request of travelTimeRequests) {
      expect(request.origin).toEqual(KYOTO_STATION)
      expect(request.destination).toEqual(NARA_PARK)
    }
  } finally {
    const { error: deleteDayLocationError } = await client
      .from('trip_day_locations')
      .delete()
      .eq('trip_id', trip.id)
    if (deleteDayLocationError) throw deleteDayLocationError
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
