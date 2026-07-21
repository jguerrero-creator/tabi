import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-121 — "Sous-type de transport sélectionnable (point-à-point vs à
// disposition)". Spec: once "Transport" is selected in the Add sheet, an
// immediate choice of sub-type — Flight/Train/Bus (point-to-point) or
// Vehicle rental (at-disposal) — determines the fields shown next. Exercises
// the Vehicle rental option end to end: field labels switch to pickup/
// drop-off, the created row persists transport_subtype = 'at_disposal', and
// the shared detail screen shows Pickup/Drop-off leg labels instead of
// Departure/Arrival.

test('selecting Vehicle rental as the transport sub-type shows pickup/drop-off fields and persists', async ({
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
      name: `E2E transport subtype trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    await page.goto(`/trips/${trip.id}/transport`)
    await expect(page.getByRole('heading', { name: 'Transport' })).toBeVisible()

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    // Default sub-type (Flight) shows point-to-point labels. The type selector is collapsed by
    // default (TABI-126) — it inherits Flight from the Transport menu without re-asking.
    await expect(page.getByLabel('Departure address')).toBeVisible()
    await expect(page.getByLabel('Arrival address')).toBeVisible()

    // Switching to Vehicle rental swaps the fields shown for pickup/drop-off.
    await page.getByRole('button', { name: 'Change type' }).click()
    await page.getByLabel('Type').selectOption('car_rental')
    await expect(page.getByLabel('Pickup city')).toBeVisible()
    await expect(page.getByLabel('Drop-off city')).toBeVisible()
    await expect(page.getByLabel('Departure address')).toHaveCount(0)

    const reservationName = `E2E car rental ${runId}`
    await page.getByLabel('Name').fill(reservationName)
    await page.getByLabel('Pickup city').fill('Tokyo Station, Tokyo, Japan')
    await page.getByLabel('Drop-off city').fill('Osaka Station, Osaka, Japan')
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Start time').fill('09:00')
    await page.getByLabel('End date').fill('2026-09-15')
    await page.getByLabel('End time').fill('18:00')

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add Reservation', exact: true }).click(),
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

    // Detail screen shows Pickup/Drop-off leg labels, not Departure/Arrival.
    await page.getByText(reservationName).click()
    await expect(page.getByRole('heading', { name: reservationName })).toBeVisible()
    await expect(page.getByText('Pickup', { exact: true })).toBeVisible()
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
