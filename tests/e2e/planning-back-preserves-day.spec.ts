import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-172 — the "Planning" nav button is lg:hidden on the desktop layout
// (TABI-149), so it's only reachable at a mobile viewport.
test.use({ viewport: { width: 390, height: 844 } })

// Regression coverage for TABI-131 ("tab + selected day live in the URL ...
// so that navigating to a reservation's detail screen and back restores
// Planning and its selected day instead of remounting to the Overview
// default" — OverviewScreen.tsx). Reported broken again (Bugs DB:
// "Régression TABI-131 : le retour depuis la fiche détail vers Planning ne
// conserve plus le jour sélectionné") — this spec is the lasting regression
// test TABI-131 never got the first time.
test('back from a reservation detail screen returns to Planning on the same day tab, not day 1', async ({
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
    .insert({ organizer_id: user.id, name: `E2E day-persist trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const day1Name = `E2E day-persist activity1 ${runId}`
    const day2Name = `E2E day-persist activity2 ${runId}`
    const day3Name = `E2E day-persist activity3 ${runId}`

    // Three real day-groups: Sep 10, Sep 11 (true middle day — neither first
    // nor last, ruling out an off-by-one that only shows up at the edges),
    // Sep 12.
    for (const [name, startAt] of [
      [day1Name, '2026-09-10T06:00:00.000Z'],
      [day2Name, '2026-09-11T06:00:00.000Z'],
      [day3Name, '2026-09-12T06:00:00.000Z'],
    ] as const) {
      const { error: insertError } = await client.from('reservations').insert({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name,
        start_at: startAt,
        start_timezone: 'Asia/Tokyo',
        end_at: null,
      })
      if (insertError) throw insertError
    }

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sep 11' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sep 12' })).toBeVisible()

    // Select the middle day tab (neither first nor last).
    await page.getByRole('button', { name: 'Sep 11' }).click()
    await expect(page).toHaveURL(/day=/)

    const mobileView = page.getByTestId('mobile-day-view')
    const day2Row = mobileView.locator('li').filter({ hasText: day2Name })
    await expect(day2Row).toBeVisible()

    // Open the reservation's detail screen.
    await day2Row.locator('a').first().click()
    await expect(page.getByRole('heading', { name: day2Name })).toBeVisible()

    // Navigate back.
    await page.getByRole('button', { name: 'Back', exact: true }).click()

    // Must land back on Planning, day 2 (Sep 11) still selected — not the
    // Overview default tab, and not day 1.
    await expect(page.getByRole('button', { name: 'Sep 11' })).toHaveClass(/bg-slate-900/)
    await expect(mobileView.locator('li').filter({ hasText: day2Name })).toBeVisible()
    await expect(mobileView.locator('li').filter({ hasText: day1Name })).toHaveCount(0)

    // Repeat once more from the *last* day too, to rule out this only
    // working for the middle tab specifically.
    await page.getByRole('button', { name: 'Sep 12' }).click()
    const day3Row = mobileView.locator('li').filter({ hasText: day3Name })
    await expect(day3Row).toBeVisible()
    await day3Row.locator('a').first().click()
    await expect(page.getByRole('heading', { name: day3Name })).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Sep 12' })).toHaveClass(/bg-slate-900/)
    await expect(mobileView.locator('li').filter({ hasText: day3Name })).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
