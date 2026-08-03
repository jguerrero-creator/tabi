import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-194 — "Ajout rapide en une ligne de texte libre (même pipeline d'extraction IA)". Same
// extraction endpoint and review screen as ImportConfirmationModal (TABI-12), just a lighter
// single-line entry point — this proves it's wired into the SAME pipeline, not a separate one.

test('one-line quick add is extracted and reviewed on the same shared Add sheet', async ({ page, registerTrip }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())

  let requestBody: { kind?: string; text?: string } | null = null
  await page.route('**/api/extract-reservation', async (route) => {
    requestBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        result: {
          type: 'stay',
          staySubtype: 'hotel',
          transportSubtype: null,
          name: 'Hotel in Kyoto',
          address: null,
          startDateTime: '2026-08-10T00:00:00',
          endDateTime: '2026-08-14T00:00:00',
          confirmationNumber: null,
          price: null,
        },
      }),
    })
  })

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
      name: `E2E quick add trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'EUR',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Quick add' })).toBeVisible()
    await page.getByRole('button', { name: 'Quick add' }).click()

    await expect(page.getByRole('heading', { name: 'Quick Add', exact: true })).toBeVisible()
    await page.getByLabel('Describe the booking in one line').fill('Hotel in Kyoto, Aug 10-14')
    await page.getByRole('button', { name: 'Create' }).click()

    // Same shared Add sheet as every other channel, prefilled, defaulting to "To book".
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByText(/extracted automatically/i)).toBeVisible()
    await expect(page.getByLabel('Name')).toHaveValue('Hotel in Kyoto')
    await expect(page.getByLabel('Start date')).toHaveValue('2026-08-10')
    await expect(page.getByLabel('End date')).toHaveValue('2026-08-14')

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
    expect(created.name).toBe('Hotel in Kyoto')
    expect(created.type).toBe('stay')
    expect(created.status).toBe('to_book')

    expect(requestBody?.kind).toBe('text')
    expect(requestBody?.text).toBe('Hotel in Kyoto, Aug 10-14')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

// TABI-11 applies here too: a failed extraction on the quick-add path must fall back to the
// same clean manual-entry form, not dead-end.
test('a failed quick-add extraction falls back to manual entry', async ({ page, registerTrip }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/extract-reservation', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Failed to extract reservation' }),
    }),
  )

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
      name: `E2E quick add failure trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'EUR',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}`)
    await page.getByRole('button', { name: 'Quick add' }).click()
    await expect(page.getByRole('heading', { name: 'Quick Add', exact: true })).toBeVisible()

    await page.getByLabel('Describe the booking in one line').fill('Something unparseable')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByText('Could not read this entry. You can enter it manually instead.')).toBeVisible()
    const fallbackCta = page.getByRole('button', { name: 'Enter manually instead' })
    await expect(fallbackCta).toBeVisible()
    await fallbackCta.click()

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByText(/extracted automatically/i)).toHaveCount(0)
    await expect(page.getByLabel('Name')).toHaveValue('')
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
