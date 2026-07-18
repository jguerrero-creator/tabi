import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-3/4/13 — the Planning tab shows one day at a time via day-tab pills
// (matches the product wireframe), with a vertical rail threading each day's
// reservations and free-time/travel blocks together. The free/travel block
// between two consecutive reservations must still show even when the second
// one's start_at falls on a different calendar day than the first — e.g. a
// multi-night Stay's checkout followed, a few hours later the same day, by a
// Transport departure. Since the Stay is grouped under its *check-in* day,
// that block previously vanished silently. It must also show réservé/trajet/
// libre as visually distinct states, not a single merged "free" row.

test('Planning shows one day at a time via day-tabs, with a cross-day free/travel block correctly placed', async ({
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
    .insert({ organizer_id: user.id, name: `E2E timeline trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const stayName = `E2E timeline stay ${runId}`
    const transportName = `E2E timeline transport ${runId}`

    // Check-in Sep 10, check-out Sep 12 — grouped under "Sep 10" by start_at.
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      status: 'booked',
      name: stayName,
      start_at: '2026-09-10T06:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      start_lat: 35.6595,
      start_lng: 139.7005, // Shibuya Station
      end_at: '2026-09-12T02:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (stayError) throw stayError

    // Departs Sep 12, 3h after checkout — grouped under "Sep 12", a *different*
    // day-group than the Stay it directly follows.
    const { error: transportError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'transport',
      status: 'booked',
      name: transportName,
      start_at: '2026-09-12T05:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      start_lat: 35.5494,
      start_lng: 139.7798, // Haneda Airport
      end_at: '2026-09-12T06:00:00.000Z',
      end_timezone: 'Asia/Tokyo',
    })
    if (transportError) throw transportError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    // Defaults to the first day; both day-tab pills exist.
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sep 12' })).toBeVisible()
    await expect(page.getByText('Local time:')).toBeVisible()

    const stayRow = page.locator('li').filter({ hasText: stayName })
    await expect(stayRow).toBeVisible()
    // Only the selected day's reservations are shown.
    await expect(page.locator('li').filter({ hasText: transportName })).toHaveCount(0)

    // The block is attached right after the reservation it follows (the Stay),
    // inside the Stay's own day (Sep 10) — not dropped because the Transport
    // it connects to starts on a later day.
    const travelRow = stayRow.locator('xpath=following-sibling::li[1]')
    await expect(travelRow).toContainText('travel')
    const freeRow = stayRow.locator('xpath=following-sibling::li[2]')
    await expect(freeRow).toContainText('free')

    await page.screenshot({ path: 'test-results/planning-timeline-visual.png', fullPage: true })

    // Switching day-tabs shows Sep 12's own reservation instead.
    await page.getByRole('button', { name: 'Sep 12' }).click()
    await expect(page.locator('li').filter({ hasText: transportName })).toBeVisible()
    await expect(stayRow).toHaveCount(0)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
