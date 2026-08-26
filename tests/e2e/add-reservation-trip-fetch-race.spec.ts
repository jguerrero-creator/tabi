import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Bug (Bugs DB, 26/08) — "AddReservationModal peut soumettre avant que le fetch du
// voyage soit terminé". AddReservationModal's own `useTrip` fetch is what feeds the
// out-of-period check (and price_currency, and the trip day-start-time default). If
// Save could be pressed while that fetch was still pending, or after it failed, the
// out-of-period check degraded to `null` and silently let the reservation through.
// Save must now stay disabled until the trip fetch settles, and stay disabled (with
// a visible error) if it fails outright — never let it through incomplete.

test('Save stays blocked while the trip fetch is pending or failed, and works once it resolves', async ({
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
      name: `E2E trip-fetch race trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-15',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  const isTripFetch = (url: string, method: string) =>
    method === 'GET' && url.includes('/rest/v1/trips') && url.includes(`id=eq.${trip.id}`)

  try {
    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    // --- Scenario 1: trip fetch still pending when the user tries to submit ---
    let releaseTripFetch: () => void = () => {}
    const tripFetchGate = new Promise<void>((resolve) => {
      releaseTripFetch = resolve
    })
    await page.route('**/rest/v1/trips*', async (route) => {
      const req = route.request()
      if (isTripFetch(req.url(), req.method())) {
        await tripFetchGate
      }
      await route.continue()
    })

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const pendingName = `E2E race pending ${runId}`
    await page.getByLabel('Name').fill(pendingName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    // Deliberately outside the trip's 2026-09-10..15 range, so if the out-of-period
    // check ran against a null trip (the bug), this would save silently instead of
    // either blocking the button or asking to extend/go back.
    await page.getByLabel('Start date').fill('2026-09-20')
    await page.getByLabel('Nights').fill('2')

    const saveButton = page.getByRole('button', { name: 'Add reservation', exact: true })
    // The trip fetch is still gated open here — button must be disabled, not just slow.
    await expect(saveButton).toBeDisabled()
    // Playwright refuses to click a disabled element outright (proves the block at the
    // framework level, not just a CSS/visual disabled look).
    await expect(saveButton.click({ trial: true, timeout: 1000 })).rejects.toThrow()

    releaseTripFetch()
    await expect(saveButton).toBeEnabled()

    // Now that the (real) trip data has actually loaded, the out-of-period check must
    // run for real and catch the out-of-range date — proving it wasn't silently skipped.
    await saveButton.click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect(page.getByText(pendingName)).toHaveCount(0)

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await page.unroute('**/rest/v1/trips*')

    // --- Scenario 2: trip fetch fails outright ---
    await page.route('**/rest/v1/trips*', async (route) => {
      const req = route.request()
      if (isTripFetch(req.url(), req.method())) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"e2e induced failure"}' })
        return
      }
      await route.continue()
    })

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const failedName = `E2E race failed-fetch ${runId}`
    await page.getByLabel('Name').fill(failedName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-11')
    await page.getByLabel('Nights').fill('2')

    const saveButtonAfterFailure = page.getByRole('button', { name: 'Add reservation', exact: true })
    await expect(saveButtonAfterFailure).toBeDisabled()
    await expect(page.getByText("Could not load this trip's details. Please close and try again.")).toBeVisible()
    await expect(saveButtonAfterFailure.click({ trial: true, timeout: 1000 })).rejects.toThrow()

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await page.unroute('**/rest/v1/trips*')

    // --- Scenario 3: normal fast path (no interception) must still work, no regression ---
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    const fastName = `E2E race fast path ${runId}`
    await page.getByLabel('Name').fill(fastName)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-11')
    await page.getByLabel('Nights').fill('2')

    const [insertResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(fastName)).toBeVisible()
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
