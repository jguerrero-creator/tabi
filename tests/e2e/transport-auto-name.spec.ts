import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-122 — "Nom auto-généré à partir du trajet (transport point-à-point)". Spec: for
// Flight/Train/Bus, the reservation name is generated from "Departure → Arrival" instead
// of a free-text name field. Exercises the default Flight sub-type in the Add sheet end to
// end: no "Name" input is rendered, a live preview of the generated name is shown as
// addresses are typed, and the persisted row's `name` matches its own start/end address.

test('point-to-point transport gets its name auto-generated from the route, with no free-text name field', async ({
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
      name: `E2E transport auto-name trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    await page.goto(`/trips/${trip.id}/transport`)
    await expect(page.getByRole('heading', { name: 'Transport' })).toBeVisible()

    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()

    // Default sub-type (Flight) is point-to-point: no free-text Name input, just a preview.
    await expect(page.getByLabel('Name')).toHaveCount(0)
    await expect(page.getByText('Generated from the route below')).toBeVisible()

    await page.getByLabel('Departure address').fill('Tokyo Station, Tokyo, Japan')
    await page.getByLabel('Arrival address').fill('Osaka Station, Osaka, Japan')

    // Preview updates live from the typed addresses, before any geocoding/submit.
    await expect(page.getByText('Tokyo Station, Tokyo, Japan → Osaka Station, Osaka, Japan')).toBeVisible()

    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByLabel('Start time').fill('09:00')
    await page.getByLabel('End date').fill('2026-09-10')
    await page.getByLabel('End time').fill('12:30')

    const [insertResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add Reservation', exact: true }).click(),
    ])
    expect(insertResponse.ok()).toBe(true)

    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    const { data: created, error: fetchError } = await client
      .from('reservations')
      .select('*')
      .eq('trip_id', trip.id)
      .single()
    if (fetchError || !created) throw fetchError ?? new Error('Reservation was not created')

    expect(created.type).toBe('transport')
    expect(created.transport_subtype).toBe('point_to_point')
    // The name is exactly the route built from this same row's own resolved addresses —
    // robust regardless of how the geocoder canonicalizes the formatted address text.
    expect(created.name).toBe(`${created.start_address} → ${created.end_address}`)

    // The list and detail screen render the auto-generated name like any other reservation.
    await expect(page.getByText(created.name)).toBeVisible()
    await page.getByText(created.name).click()
    await expect(page.getByRole('heading', { name: created.name })).toBeVisible()

    // Editing the arrival address on the detail screen keeps the name in sync with the route.
    await expect(page.getByLabel('Name')).toHaveCount(0)
    await page.getByLabel('End address').fill('Kyoto Station, Kyoto, Japan')

    const [updateResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Save' }).click(),
    ])
    expect(updateResponse.ok()).toBe(true)

    const { data: updated, error: updateFetchError } = await client
      .from('reservations')
      .select('*')
      .eq('id', created.id)
      .single()
    if (updateFetchError || !updated) throw updateFetchError ?? new Error('Reservation was not updated')

    expect(updated.end_address).not.toBe(created.end_address)
    expect(updated.name).toBe(`${updated.start_address} → ${updated.end_address}`)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
