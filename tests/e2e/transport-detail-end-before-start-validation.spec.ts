import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-215 — the Transport leg date pair in ReservationDetailScreen.tsx had no
// browser-level coverage proving its submit-time guard (endDate < startDate)
// actually blocks a save, unlike Stay's equivalent check (see
// reservation-detail-nights-validation.spec.ts). TABI-210's `min` date-picker
// constraint only stops selection in browsers that enforce it — this verifies
// the same submit-time check Stay/Activity already have also fires for
// Transport when an out-of-order value reaches submit (e.g. typed directly,
// bypassing `min`), and that a normal, valid edit still saves.

test('editing a Transport arrival to before its departure shows a clear error, not a silent block', async ({
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
      name: `E2E transport end-before-start trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { data: reservation, error: reservationError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        name: `E2E transport end-before-start ${runId}`,
        start_at: '2026-09-12T09:00:00.000Z',
        start_timezone: 'UTC',
        end_at: '2026-09-12T12:00:00.000Z',
        end_timezone: 'UTC',
      })
      .select()
      .single()
    if (reservationError || !reservation) throw reservationError ?? new Error('Reservation insert returned no row')

    await page.goto(`/reservations/${reservation.id}`)
    await expect(page.getByRole('heading', { name: `E2E transport end-before-start ${runId}` })).toBeVisible()

    // Types the arrival date directly rather than using the picker, the same path that
    // bypasses TABI-210's `min` constraint in browsers/assistive tech that don't enforce it.
    const endDate = page.getByLabel('Arrival date')
    await endDate.fill('2026-09-11')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('End must be on or after start.')).toBeVisible()

    const { data: unchanged, error: refetchError } = await client
      .from('reservations')
      .select('*')
      .eq('id', reservation.id)
      .single()
    if (refetchError || !unchanged) throw refetchError ?? new Error('Reservation disappeared')
    expect(new Date(unchanged.end_at!).toISOString()).toBe('2026-09-12T12:00:00.000Z')

    // A valid correction still saves normally.
    await endDate.fill('2026-09-13')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Saved')).toBeVisible()

    const { data: saved, error: refetchAfterFixError } = await client
      .from('reservations')
      .select('*')
      .eq('id', reservation.id)
      .single()
    if (refetchAfterFixError || !saved) throw refetchAfterFixError ?? new Error('Reservation disappeared')
    expect(new Date(saved.end_at!).toISOString()).toBe('2026-09-13T12:00:00.000Z')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
