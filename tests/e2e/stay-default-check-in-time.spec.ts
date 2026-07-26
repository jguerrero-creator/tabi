import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-144 — "Indicateur + édition de l'heure de check-in par défaut, modifiable
// ultérieurement". Spec: when a Stay's check-in/check-out time is left blank, a
// standard default (15:00/11:00, per TABI-16) is applied and the row is flagged as
// unconfirmed on the detail screen. Exercises leaving both times blank in the Add
// sheet, seeing the resulting default flags + badges, then editing the check-in
// time from the detail screen to confirm it clears the flag.

test('Stay check-in/check-out defaults to 15:00/11:00 when left blank, editable later', async ({ page }) => {
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
      name: `E2E default check-in time trip ${runId}`,
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

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const reservationName = `E2E default time ${runId}`
    await page.getByLabel('Name').fill(reservationName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-10')
    // Start/end time intentionally left blank — the point of this test.
    await page.getByLabel('Nights').fill('2')

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')
    expect(created.start_time_is_default).toBe(true)
    expect(created.end_time_is_default).toBe(true)
    // 2026-09-10 15:00 JST (UTC+9) => 2026-09-10T06:00:00.000Z
    expect(created.start_at).toBe('2026-09-10T06:00:00+00:00')
    // 2026-09-12 11:00 JST (UTC+9) => 2026-09-12T02:00:00.000Z
    expect(created.end_at).toBe('2026-09-12T02:00:00+00:00')

    // Detail screen: "Default" badge shown next to both check-in and check-out times.
    await page.goto(`/reservations/${created.id}`)
    await expect(page.getByRole('heading', { name: reservationName })).toBeVisible()
    await expect(page.getByText('Default', { exact: true })).toHaveCount(2)
    await expect(page.getByLabel('Check-in time')).toHaveValue('15:00')
    await expect(page.getByLabel('Check-out time')).toHaveValue('11:00')

    // Editing the check-in time confirms it and clears the default flag.
    await page.getByLabel('Check-in time').fill('16:30')

    const [updateResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Save' }).click(),
    ])
    expect(updateResponse.ok()).toBe(true)

    const { data: afterEdit, error: afterEditError } = await client
      .from('reservations')
      .select('*')
      .eq('id', created.id)
      .single()
    if (afterEditError) throw afterEditError
    expect(afterEdit.start_time_is_default).toBe(false)
    expect(afterEdit.end_time_is_default).toBe(true)
    // 2026-09-10 16:30 JST (UTC+9) => 2026-09-10T07:30:00.000Z
    expect(afterEdit.start_at).toBe('2026-09-10T07:30:00+00:00')

    // Only the check-out badge remains after check-in was confirmed.
    await expect(page.getByText('Default', { exact: true })).toHaveCount(1)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
