import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-12 — "Écran de vérification/correction des données extraites". The AI extraction
// itself (TABI-8, api/extract-reservation.ts) is stubbed here since there's no local
// ANTHROPIC_API_KEY for the e2e dev server — this exercises everything downstream of it: the
// paste-text entry point, mapping the extraction onto the shared Add sheet's prefill fields,
// the "extracted automatically" review banner, and saving the (possibly corrected) result.

test('pasted confirmation text is extracted, shown for review, and saved as a reservation', async ({ page }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/extract-reservation', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        result: {
          type: 'stay',
          staySubtype: 'hotel',
          transportSubtype: null,
          name: 'Hotel Sakura Kyoto',
          address: '123 Gion St, Kyoto, Japan',
          startDateTime: '2026-08-10T15:00:00',
          endDateTime: '2026-08-13T11:00:00',
          confirmationNumber: 'ABC123',
          price: { amount: 450, currency: 'EUR' },
        },
      }),
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
      name: `E2E extraction review trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'EUR',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Import confirmation' })).toBeVisible()
    await page.getByRole('button', { name: 'Import confirmation' }).click()

    await expect(page.getByRole('heading', { name: 'Import Confirmation Email' })).toBeVisible()
    await page
      .getByLabel('Confirmation email or booking text')
      .fill(
        'Booking confirmed: Hotel Sakura Kyoto, 123 Gion St, Kyoto. Check-in Aug 10 2026 15:00, ' +
          'check-out Aug 13 2026 11:00. Confirmation #ABC123. Total: 450 EUR',
      )
    await page.getByRole('button', { name: 'Extract' }).click()

    // Review screen: the shared Add sheet, prefilled, with the extraction-review banner.
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByText(/extracted automatically/i)).toBeVisible()
    await expect(page.getByLabel('Name')).toHaveValue('Hotel Sakura Kyoto')
    await expect(page.getByLabel('Address')).toHaveValue('123 Gion St, Kyoto, Japan')
    await expect(page.getByLabel('Start date')).toHaveValue('2026-08-10')
    await expect(page.getByLabel('Start time')).toHaveValue('15:00')
    await expect(page.getByLabel('End date')).toHaveValue('2026-08-13')
    await expect(page.getByLabel('End time')).toHaveValue('11:00')
    await expect(page.getByLabel('Price')).toHaveValue('450')
    await expect(page.getByLabel('Notes')).toHaveValue('Confirmation: ABC123')

    // Correct one extracted field, as the ticket's spec requires the user be able to.
    await page.getByLabel('Name').fill('Hotel Sakura Kyoto (corrected)')

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
    expect(created.name).toBe('Hotel Sakura Kyoto (corrected)')
    expect(created.type).toBe('stay')
    expect(created.stay_subtype).toBe('hotel')
    expect(created.note).toBe('Confirmation: ABC123')
    expect(created.price_amount).toBe(450)
    expect(created.price_currency).toBe('EUR')
    expect(created.status).toBe('to_book')
    // 2026-08-10 15:00 JST (UTC+9) => 2026-08-10T06:00:00Z
    expect(created.start_at).toBe('2026-08-10T06:00:00+00:00')
    // 2026-08-13 11:00 JST (UTC+9) => 2026-08-13T02:00:00Z
    expect(created.end_at).toBe('2026-08-13T02:00:00+00:00')
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

// TABI-15 — "Import via copier-coller / upload d'un email de confirmation". The upload half
// of the same modal: no separate parsing path, the file's raw text is read client-side into the
// same textarea/extraction call the paste path (above) already exercises.
test('uploaded .eml file is read into the text field and extracted the same way as pasted text', async ({ page }) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/extract-reservation', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        result: {
          type: 'activity',
          staySubtype: null,
          transportSubtype: null,
          name: 'Fushimi Inari Guided Tour',
          address: 'Fushimi Inari Taisha, Kyoto, Japan',
          startDateTime: '2026-08-11T09:00:00',
          endDateTime: null,
          confirmationNumber: 'XYZ789',
          price: { amount: 60, currency: 'EUR' },
        },
      }),
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
      name: `E2E extraction upload trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'EUR',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  // A real .eml uses CRLF line endings, but a <textarea>'s .value always normalizes them to
  // LF on read — assert against LF here so the check reflects what the DOM actually reports.
  const emlContent =
    'From: bookings@example.com\nSubject: Your Fushimi Inari Guided Tour\n\n' +
    'Guided tour confirmed for Aug 11 2026 09:00 at Fushimi Inari Taisha, Kyoto. ' +
    'Confirmation #XYZ789. Total: 60 EUR'

  try {
    await page.goto(`/trips/${trip.id}`)
    await page.getByRole('button', { name: 'Import confirmation' }).click()
    await expect(page.getByRole('heading', { name: 'Import Confirmation Email' })).toBeVisible()

    await page.getByLabel(/Or upload the email file/).setInputFiles({
      name: 'confirmation.eml',
      mimeType: 'message/rfc822',
      buffer: Buffer.from(emlContent),
    })

    // The file's raw text lands in the same textarea the paste path uses — proves there's no
    // separate upload-parsing branch, just a different way of filling the one text field.
    await expect(page.getByLabel('Confirmation email or booking text')).toHaveValue(emlContent)

    await page.getByRole('button', { name: 'Extract' }).click()

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByText(/extracted automatically/i)).toBeVisible()
    await expect(page.getByLabel('Name')).toHaveValue('Fushimi Inari Guided Tour')
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
