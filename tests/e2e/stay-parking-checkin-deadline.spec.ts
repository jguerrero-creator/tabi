import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-70 — "Deadline de check-in + parking mis en avant pour chaque
// logement". Spec: for Stay reservations, a "parking included" (yes/no)
// field and a "check-in deadline" field, visually highlighted in the Stay
// menu — avoids arriving at a closed door. Exercises setting both in the Add
// sheet, seeing the resulting flag badges in the Stay list and on the detail
// screen, then editing them from the detail screen.

test('parking + check-in deadline flags on a Stay reservation', async ({ page, registerTrip }) => {
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
      name: `E2E parking/check-in deadline trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    // Fields exist and default to unselected/blank.
    await expect(page.getByRole('radio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByLabel('Check-in deadline')).toHaveValue('')

    await page.getByRole('radio', { name: 'No' }).click()
    await expect(page.getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'true')
    await page.getByLabel('Check-in deadline').fill('22:00')

    const reservationName = `E2E parking flag ${runId}`
    await page.getByLabel('Name').fill(reservationName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Start time').fill('15:00')
    await page.getByLabel('Nights').fill('2')
    await page.getByLabel('End time').fill('11:00')

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    // Flags surfaced in the Stay list row.
    await expect(page.getByText(reservationName)).toBeVisible()
    await expect(page.getByText('No parking')).toBeVisible()
    await expect(page.getByText('Check-in by 22:00')).toBeVisible()

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')
    expect(created.stay_parking_included).toBe(false)
    expect(created.stay_check_in_deadline).toBe('22:00:00')

    // Detail screen: flags shown, and fields editable.
    await page.goto(`/reservations/${created.id}`)
    await expect(page.getByRole('heading', { name: reservationName })).toBeVisible()
    await expect(page.getByText('No parking')).toBeVisible()
    await expect(page.getByText('Check-in by 22:00')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByLabel('Check-in deadline')).toHaveValue('22:00')

    await page.getByRole('radio', { name: 'Yes' }).click()
    await page.getByLabel('Check-in deadline').fill('')

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
    expect(afterEdit.stay_parking_included).toBe(true)
    expect(afterEdit.stay_check_in_deadline).toBeNull()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
