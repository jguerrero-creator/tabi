import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-112 — "Saisie par nombre de nuitées plutôt que date de sortie
// (Hébergement)". Spec: for Stay, a "nights" field replaces manual checkout
// entry. Checkout date is computed (check-in + nights) and shown read-only,
// with a toggle to fall back to manual checkout-date entry if needed.

test('entering nights computes a read-only checkout date for a Stay reservation', async ({ page }) => {
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
      name: `E2E nights trip ${runId}`,
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

    // Checkout date starts disabled and blank until both start date and nights are set.
    const endDateInput = page.getByLabel('End date')
    await expect(endDateInput).toBeDisabled()
    await expect(endDateInput).toHaveValue('')

    await page.getByLabel('Name').fill(`E2E nights hotel ${runId}`)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Start time').fill('15:00')
    await page.getByLabel('Nights').fill('3')
    await page.getByLabel('End time').fill('11:00')

    await expect(endDateInput).toBeDisabled()
    await expect(endDateInput).toHaveValue('2026-09-13')

    const [insertResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
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

    // 2026-09-13 11:00 JST (UTC+9) => 2026-09-13T02:00:00.000Z
    expect(new Date(created.end_at!).toISOString()).toBe('2026-09-13T02:00:00.000Z')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('the manual checkout toggle switches to a directly editable end date and back', async ({ page }) => {
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
      name: `E2E nights toggle trip ${runId}`,
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

    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Nights').fill('2')
    await expect(page.getByLabel('End date')).toHaveValue('2026-09-12')

    await page.getByRole('button', { name: 'Enter checkout date manually' }).click()
    await expect(page.getByLabel('Nights')).toHaveCount(0)
    const endDateInput = page.getByLabel('End date')
    await expect(endDateInput).toBeEnabled()
    await endDateInput.fill('2026-09-20')
    await expect(endDateInput).toHaveValue('2026-09-20')

    // Switching back to nights recomputes checkout from the still-set nights value (2),
    // overriding the manually-picked date.
    await page.getByRole('button', { name: 'Use nights instead' }).click()
    await expect(page.getByLabel('End date')).toHaveValue('2026-09-12')
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('submitting a Stay reservation without nights shows a nights-specific error', async ({ page }) => {
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
      name: `E2E nights required trip ${runId}`,
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

    await page.getByLabel('Name').fill(`E2E nights required ${runId}`)
    await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Start time').fill('15:00')
    await page.getByLabel('End time').fill('11:00')
    // Nights left blank on purpose.

    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByText('Number of nights is required.')).toBeVisible()
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

// TABI-185 — completes the TABI-112 addendum (25/07): 0 or negative nights must be
// rejected with the app's own clear error, never silently accepted or blocked only by
// the native HTML5 min={1} tooltip. The detail screen has its own coverage for this
// (reservation-detail-nights-validation.spec.ts); this closes the matching gap on the
// add flow, which only had blank-nights coverage until now.
for (const invalidNights of ['0', '-1']) {
  test(`entering ${invalidNights} nights shows a clear error, not a silent block`, async ({ page }) => {
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
        name: `E2E invalid nights trip ${runId}`,
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

      await page.getByLabel('Name').fill(`E2E invalid nights hotel ${runId}`)
      await page.getByLabel('Address').fill('1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan')
      await page.getByLabel('Start date').fill('2026-09-10')
      await page.getByLabel('Start time').fill('15:00')
      await page.getByLabel('Nights').fill(invalidNights)
      await page.getByLabel('End time').fill('11:00')

      // Checkout stays blank — the derivation effect refuses to compute a date from
      // an invalid nights value rather than silently producing a nonsense checkout.
      await expect(page.getByLabel('End date')).toHaveValue('')

      await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
      await expect(page.getByText('Number of nights is required.')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

      const { count } = await client
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('trip_id', trip.id)
      expect(count).toBe(0)
    } finally {
      const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
      if (deleteTripError) throw deleteTripError
    }
  })
}
