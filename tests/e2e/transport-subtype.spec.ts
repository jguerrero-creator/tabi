import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-121 — "Sous-type de transport sélectionnable (point-à-point vs à
// disposition)". Spec: once "Transport" is selected in the Add sheet, an
// immediate choice of sub-type — Flight/Train/Bus (point-to-point) or
// Vehicle rental (at-disposal) — determines the fields shown next. Exercises
// the Vehicle rental option end to end: field labels switch to pick-up/
// drop-off, the created row persists transport_subtype = 'at_disposal', and
// the shared detail screen shows Pick-up/Drop-off leg labels instead of
// Departure/Arrival.

test('selecting Vehicle rental as the transport sub-type shows pickup/drop-off fields and persists', async ({
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
      name: `E2E transport subtype trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/transport`)
    await expect(page.getByRole('heading', { name: 'Transport' })).toBeVisible()

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    // Default sub-type (point-to-point) shows point-to-point labels. The main type selector is
    // collapsed by default (TABI-126) — it inherits Transport from the Transport menu without
    // re-asking — but the subtype radio group is always shown whenever the main type is
    // Transport (TABI-121), regardless of whether that selector is expanded.
    await expect(page.getByLabel('Departure address')).toBeVisible()
    await expect(page.getByLabel('Arrival address')).toBeVisible()

    // Switching to Vehicle rental swaps the fields shown for pickup/drop-off.
    await page.getByRole('radio', { name: 'Vehicle rental' }).click()
    await expect(page.getByLabel('Pick-up city')).toBeVisible()
    await expect(page.getByLabel('Drop-off city')).toBeVisible()
    await expect(page.getByLabel('Departure address')).toHaveCount(0)

    const reservationName = `E2E car rental ${runId}`
    await page.getByLabel('Name').fill(reservationName)
    await page.getByLabel('Pick-up city').fill('Tokyo Station, Tokyo, Japan')
    await page.getByLabel('Drop-off city').fill('Osaka Station, Osaka, Japan')
    // Vehicle rental is a duration, not a route (CLAUDE.md #5b) — date only, no time-of-day fields.
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('End date').fill('2026-09-15')

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(reservationName)).toBeVisible()

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.type).toBe('transport')
    expect(created.transport_subtype).toBe('at_disposal')

    // Detail screen shows Pick-up/Drop-off leg labels, not Departure/Arrival.
    await page.getByText(reservationName).click()
    await expect(page.getByRole('heading', { name: reservationName })).toBeVisible()
    await expect(page.getByText('Pick-up', { exact: true })).toBeVisible()
    await expect(page.getByText('Drop-off', { exact: true })).toBeVisible()
    await expect(page.getByText('Departure')).toHaveCount(0)
    await expect(page.getByText('Arrival')).toHaveCount(0)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
