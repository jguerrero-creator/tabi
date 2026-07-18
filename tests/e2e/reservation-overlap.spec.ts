import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-108/109 — overlap detection reuses the trip's date-range semantics
// (half-open — a checkout exactly at another's check-in is not an overlap).
// Per the Decision Log, an overlap is never blocked and never silently
// ignored: saving asks for explicit confirmation (with an optional note).

test('adding a reservation that overlaps an existing same-type reservation asks for confirmation', async ({
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
      name: `E2E overlap trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const existingName = `E2E overlap existing ${runId}`
    const { error: seedError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      status: 'booked',
      name: existingName,
      start_at: '2026-09-10T06:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-09-12T02:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (seedError) throw seedError

    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()
    await expect(page.getByText(existingName)).toBeVisible()

    // Overlapping candidate: check-in the night before the existing checkout.
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.getByLabel('Name').fill(`E2E overlap candidate ${runId}`)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-11')
    await page.getByLabel('Start time').fill('15:00')
    await page.getByRole('button', { name: 'Enter checkout date manually' }).click()
    await page.getByLabel('End date').fill('2026-09-13')
    await page.getByLabel('End time').fill('11:00')
    await page.getByRole('button', { name: 'Add Reservation', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Overlapping dates' })).toBeVisible()
    await expect(page.getByText(`This overlaps with "${existingName}". Is this intended?`)).toBeVisible()
    // Not blocked — cancelling ("Go back") returns to the still-open form, nothing saved yet.
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Overlapping dates' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByText(`E2E overlap candidate ${runId}`)).toHaveCount(0)

    // Re-submit and confirm this time: the optional note is appended to the reservation note.
    await page.getByRole('button', { name: 'Add Reservation', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Overlapping dates' })).toBeVisible()
    await page.getByLabel('Note (optional)').fill('Two bookings on purpose, boat trip in between.')

    const [insertOverlapResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Yes, save anyway' }).click(),
    ])
    expect(insertOverlapResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(`E2E overlap candidate ${runId}`)).toBeVisible()

    // Back-to-back is not an overlap: check-in exactly at the confirmed candidate's checkout
    // instant (which is itself already back-to-back-adjacent to the original seed's checkout).
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-13')
    await page.getByLabel('Start time').fill('11:00')
    await page.getByRole('button', { name: 'Enter checkout date manually' }).click()
    await page.getByLabel('End date').fill('2026-09-14')
    await page.getByLabel('End time').fill('10:00')

    const backToBackName = `E2E overlap back-to-back ${runId}`
    await page.getByLabel('Name').fill(backToBackName)

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add Reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(backToBackName)).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
