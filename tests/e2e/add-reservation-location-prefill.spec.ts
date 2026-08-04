import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-204 — "Lieu pré-rempli avec le dernier lieu du même voyage". Spec: the
// Add sheet's address field prefills with the trip's most recent planned
// day-location or geocoded reservation address (whichever is chronologically
// later), across reservation types, instead of starting blank — stays fully
// editable/searchable via autocomplete afterward.

test('prefills the address from the trip\'s last geocoded reservation, across types', async ({ page, registerTrip }) => {
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
      name: `E2E location prefill trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-20',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // A point-to-point Transport reservation contributes its *arrival* (end)
    // location, not its departure — that's where the traveler ends up.
    const { error: reservationError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      transport_subtype: 'point_to_point',
      status: 'booked',
      name: `E2E flight to Osaka ${runId}`,
      start_at: '2026-09-10T01:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      start_address: 'Narita Airport',
      start_lat: 35.7719,
      start_lng: 140.3929,
      end_at: '2026-09-10T04:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
      end_address: 'Kansai International Airport, Osaka',
      end_lat: 34.4342,
      end_lng: 135.2441,
      end_place_name: 'Kansai International Airport',
      end_city: 'Osaka',
    })
    if (reservationError) throw reservationError

    // Opened from a different menu (Activities) than the seeded reservation's
    // type (Transport) — the prefill isn't scoped to the current type.
    await page.goto(`/trips/${trip.id}/activities`)
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible()

    await page.route('https://maps.googleapis.com/**', (route) => route.abort())
    await page.getByRole('button', { name: 'Add activity' }).click()
    await expect(page.getByRole('heading', { name: 'Find a place' })).toBeVisible()
    await page.getByRole('button', { name: 'Enter manually instead' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    await expect(page.getByLabel('Address')).toHaveValue('Kansai International Airport, Osaka')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('prefers the more recent day-planned location over an earlier reservation address', async ({ page, registerTrip }) => {
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
      name: `E2E location prefill recency trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-20',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: `E2E early stay ${runId}`,
      start_at: '2026-09-10T00:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      start_address: 'Old Hotel Kyoto',
      start_lat: 35.0116,
      start_lng: 135.7681,
      start_city: 'Kyoto',
    })
    if (reservationError) throw reservationError

    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2026-09-15',
      place_name: 'Osaka Castle Area',
      address: 'Osaka, Japan',
      lat: 34.6873,
      lng: 135.5262,
      city: 'Osaka',
      timezone: 'Asia/Tokyo',
    })
    if (dayLocationError) throw dayLocationError

    await page.goto(`/trips/${trip.id}/activities`)
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible()

    await page.route('https://maps.googleapis.com/**', (route) => route.abort())
    await page.getByRole('button', { name: 'Add activity' }).click()
    await expect(page.getByRole('heading', { name: 'Find a place' })).toBeVisible()
    await page.getByRole('button', { name: 'Enter manually instead' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    await expect(page.getByLabel('Address')).toHaveValue('Osaka, Japan')
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

test('leaves the address blank when the trip has no known location yet', async ({ page, registerTrip }) => {
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
      name: `E2E location prefill empty trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-20',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/activities`)
    await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible()

    await page.route('https://maps.googleapis.com/**', (route) => route.abort())
    await page.getByRole('button', { name: 'Add activity' }).click()
    await expect(page.getByRole('heading', { name: 'Find a place' })).toBeVisible()
    await page.getByRole('button', { name: 'Enter manually instead' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    await expect(page.getByLabel('Address')).toHaveValue('')
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
