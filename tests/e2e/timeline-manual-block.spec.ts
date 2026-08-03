import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Mobile viewport: the day-tab pills and single-day rail (where the "+" on a
// free-time block lives) only render below the `lg` breakpoint — at desktop
// width the equivalent surface is the multi-column carousel instead.
test.use({ viewport: { width: 390, height: 844 } })

// TABI-54 — "+" on a free-time block in the Planning rail opens the shared
// Add sheet pre-seeded with that block's own start time/timezone, so adding
// a manual entry ("free time", "walk") doesn't require going through the
// full formal-reservation flow. Unlike Stay/Transport/Activities menus,
// a free-time block has no origin menu to inherit a type from, so the
// type selector opens expanded (Activity/Stay/Transport), forcing an
// explicit choice instead of silently assuming one.

test('a manual block can be added from a free-time slot on the Planning rail', async ({ page, registerTrip }) => {
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
    .insert({ organizer_id: user.id, name: `E2E manual-block trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const stayName = `E2E manual-block stay ${runId}`
    const blockName = `E2E manual block ${runId}`

    // Check-out at 08:00 JST leaves the rest of Sep 10 as trailing free time.
    const { error: stayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      status: 'booked',
      name: stayName,
      start_at: '2026-09-09T15:00:00.000Z',
      start_timezone: 'Asia/Tokyo',
      end_at: '2026-09-09T23:00:00.000Z', // 2026-09-10T08:00 JST
      end_timezone: 'Asia/Tokyo',
    })
    if (stayError) throw stayError

    await page.goto(`/trips/${trip.id}`)
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()
    await page.getByRole('button', { name: 'Sep 10' }).click()

    const addFreeBlockButton = page.getByRole('button', { name: 'Add something here' })
    await expect(addFreeBlockButton).toBeVisible()
    await addFreeBlockButton.click()

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    // Type selector opens expanded — an explicit choice, not a silently assumed default —
    // pre-selected on Activity, the one type with no required address.
    const typeSelect = page.getByLabel('Type')
    await expect(typeSelect).toHaveValue('activity')
    await expect(typeSelect.locator('option')).toHaveText(['Stay', 'Transport', 'Activity'])
    // Start date/time pre-seeded from the free block's own JST start (08:00), not the runner's local time.
    await expect(page.locator('input[type="date"]').first()).toHaveValue('2026-09-10')
    await expect(page.locator('input[type="time"]').first()).toHaveValue('08:00')

    await page.getByLabel('Name').fill(blockName)
    await page.getByRole('button', { name: 'Add Reservation' }).click()

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).not.toBeVisible()
    await expect(page.locator('li').filter({ hasText: blockName }).first()).toBeVisible()

    await page.screenshot({ path: 'test-results/timeline-manual-block.png', fullPage: true })
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
