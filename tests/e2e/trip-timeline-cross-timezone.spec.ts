import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-172 — the "Planning" nav button is lg:hidden on the desktop layout
// (TABI-149), so it's only reachable at a mobile viewport.
test.use({ viewport: { width: 390, height: 844 } })

// TABI-65 — "Affichage contextualisé des heures selon le fuseau local": the
// Planning rail must display each reservation (and the free time around it)
// in its own location's timezone, switching reference at arrival rather than
// stamping the whole day with one anchor timezone (previously always the
// first reservation's start_timezone). Seeds two same-day-tab reservations —
// one in New York, one in Chicago (1h apart, both DST in September, so the
// difference isn't explainable by daylight saving alone) — with no lat/lng,
// so no travel-time lookup runs and the gap between them is pure free time;
// the only thing under test is which timezone each rail entry renders in.

test('Planning rail shows each entry in its own local timezone, not one day-wide anchor', async ({ page }) => {
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
    .insert({ organizer_id: user.id, name: `E2E TZ rail trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const nyName = `E2E TZ rail NY ${runId}`
    const chicagoName = `E2E TZ rail Chicago ${runId}`

    // 9:00–11:00 AM in New York (America/New_York, EDT = UTC-4 in September).
    const { error: nyError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'activity',
      status: 'booked',
      name: nyName,
      start_at: '2026-09-10T13:00:00.000Z',
      start_timezone: 'America/New_York',
      end_at: '2026-09-10T15:00:00.000Z',
      end_timezone: 'America/New_York',
    })
    if (nyError) throw nyError

    // Same calendar day, but in Chicago (America/Chicago, CDT = UTC-5 in
    // September) — one dateKey ("2026-09-10") merges both under one day-tab.
    const { error: chicagoError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'activity',
      status: 'booked',
      name: chicagoName,
      start_at: '2026-09-10T21:00:00.000Z',
      start_timezone: 'America/Chicago',
    })
    if (chicagoError) throw chicagoError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()
    await expect(page.getByRole('button', { name: 'Sep 10' })).toBeVisible()

    // Scoped to the mobile single-day view (data-testid="mobile-day-view") —
    // the desktop multi-day carousel (TABI-149) renders every day's rail at
    // once too, just CSS-hidden at this viewport, so an unscoped locator
    // matches both copies and fails Playwright's strict mode (TABI-172 follow-up).
    const mobileView = page.getByTestId('mobile-day-view')
    const nyRow = mobileView.locator('li').filter({ hasText: nyName })
    const chicagoRow = mobileView.locator('li').filter({ hasText: chicagoName })
    await expect(nyRow).toBeVisible()
    await expect(chicagoRow).toBeVisible()

    // NY reservation renders its own start in NY local time (24h format).
    await expect(nyRow).toContainText('09:00')

    // Chicago reservation must render in Chicago local time (16:00) — not
    // the day's single anchor timezone (NY), which would show 17:00 for
    // the exact same instant. This is the regression TABI-65 fixes: before,
    // every rail entry used the first reservation's timezone for the whole
    // day, regardless of which location that entry actually belonged to.
    await expect(chicagoRow).toContainText('16:00')
    await expect(chicagoRow).not.toContainText('17:00')

    // The free-time entry between the two reservations switches to the
    // destination's timezone (Chicago, 10:00) once its clock is showing
    // "time until the next booking" rather than the NY departure anchor
    // (11:00) — the "switch reference at arrival" behavior from TABI-65.
    const freeRow = nyRow.locator('xpath=following-sibling::li[1]')
    await expect(freeRow).toContainText('free')
    await expect(freeRow).toContainText('10:00')
    await expect(freeRow).not.toContainText('11:00')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
