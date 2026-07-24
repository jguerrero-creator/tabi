import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-16 — "Formulaire de saisie manuelle d'une réservation". Spec: type
// (hôtel/vol/train/transport local/activité), nom, adresse, date/heure
// début, date/heure fin, prix (optionnel), statut (3 états), note libre.
// Exercises the "+" entry point on the Stay menu end to end: fills the Add
// Reservation form (including a real address, to also cover geocoding),
// submits, and verifies both the inserted row (type mapping, UTC
// conversion from the JST wall-clock input, resolved timezone stored on
// both legs) and that the Stay list / detail screen render it correctly.

test('a reservation can be created from the Stay menu via the Add Reservation form', async ({ page }) => {
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
      name: `E2E add-reservation trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()
    await expect(page.getByText('No stays booked yet')).toBeVisible()

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const reservationName = `E2E hotel ${runId}`
    await page.getByLabel('Name').fill(reservationName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Start time').fill('15:00')
    await page.getByRole('button', { name: 'Enter checkout date manually' }).click()
    await page.getByLabel('End date').fill('2026-09-12')
    await page.getByLabel('End time').fill('11:00')
    await page.getByLabel('Price').fill('250')
    await page.getByLabel('Notes').fill('Booked via e2e verification')
    await page.getByRole('radio', { name: 'Booked' }).click()

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add Reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)

    // Modal closes and the new reservation shows up in the Stay list.
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(reservationName)).toBeVisible()
    await expect(page.getByText('No stays booked yet')).toHaveCount(0)

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.type).toBe('stay')
    expect(created.status).toBe('booked')
    expect(created.name).toBe(reservationName)
    expect(created.price_amount).toBe(250)
    // No currency field in the form — inherited straight from the trip's own currency.
    expect(created.price_currency).toBe('USD')
    expect(created.note).toBe('Booked via e2e verification')
    expect(created.start_timezone).toBe('Asia/Tokyo')
    expect(created.end_timezone).toBe('Asia/Tokyo')
    // 2026-09-10 15:00 JST (UTC+9) => 2026-09-10T06:00:00.000Z
    expect(new Date(created.start_at).toISOString()).toBe('2026-09-10T06:00:00.000Z')
    // 2026-09-12 11:00 JST (UTC+9) => 2026-09-12T02:00:00.000Z
    expect(new Date(created.end_at!).toISOString()).toBe('2026-09-12T02:00:00.000Z')

    // Detail screen renders the newly created reservation correctly.
    await page.getByText(reservationName).click()
    await expect(page.getByRole('heading', { name: reservationName })).toBeVisible()
    await expect(page.getByText('Check-in', { exact: true })).toBeVisible()
    await expect(page.getByText('Check-out', { exact: true })).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
