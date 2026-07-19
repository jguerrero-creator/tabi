import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-5 — "Support de plusieurs types de réservation". Spec: "Le type de
// réservation détermine l'icône et les champs affichés (ex: vol = numéro de
// vol, hôtel = adresse + check-in/out)." Seeds one reservation per type
// (stay, transport, activity) under the same trip and verifies, on the
// shared detail screen, that: the type label and leg labels differ per
// type, the end-address edit field only appears for transport, and the
// rendered type icon differs between types.

const START_AT = '2026-09-01T10:00:00.000Z'
const END_AT = '2026-09-01T14:00:00.000Z'

test('reservation type determines the icon and the fields shown on the detail screen', async ({ page }) => {
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
      name: `E2E types trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const { data: reservations, error: reservationsError } = await client
      .from('reservations')
      .insert([
        { trip_id: trip.id, type: 'stay', name: `E2E stay ${runId}`, start_at: START_AT, end_at: END_AT },
        {
          trip_id: trip.id,
          type: 'transport',
          name: `E2E transport ${runId}`,
          start_at: START_AT,
          start_timezone: 'Europe/Paris',
          end_at: END_AT,
          end_timezone: 'Europe/Paris',
        },
        { trip_id: trip.id, type: 'activity', name: `E2E activity ${runId}`, start_at: START_AT, end_at: null },
      ])
      .select()
    if (reservationsError || !reservations) throw reservationsError ?? new Error('Reservation insert returned no rows')

    const byType = Object.fromEntries(reservations.map((r) => [r.type, r])) as Record<
      'stay' | 'transport' | 'activity',
      (typeof reservations)[number]
    >

    // Stay: Check-in / Check-out, no end-address field, "Stay" type label.
    await page.goto(`/reservations/${byType.stay.id}`)
    await expect(page.getByRole('heading', { name: `E2E stay ${runId}` })).toBeVisible()
    await expect(page.getByText('Stay', { exact: true })).toBeVisible()
    await expect(page.getByText('Check-in')).toBeVisible()
    await expect(page.getByText('Check-out')).toBeVisible()
    await expect(page.getByText('End address')).toHaveCount(0)
    const stayIcon = await page.locator('svg[aria-hidden="true"]').first().innerHTML()

    // Transport: Departure / Arrival, end-address field present, "Transport" type label.
    await page.goto(`/reservations/${byType.transport.id}`)
    await expect(page.getByRole('heading', { name: `E2E transport ${runId}` })).toBeVisible()
    await expect(page.getByText('Transport', { exact: true })).toBeVisible()
    await expect(page.getByText('Departure')).toBeVisible()
    await expect(page.getByText('Arrival')).toBeVisible()
    await expect(page.getByText('End address')).toBeVisible()
    const transportIcon = await page.locator('svg[aria-hidden="true"]').first().innerHTML()

    // Activity: Start only (no End label, since end_at is null), no end-address field.
    await page.goto(`/reservations/${byType.activity.id}`)
    await expect(page.getByRole('heading', { name: `E2E activity ${runId}` })).toBeVisible()
    await expect(page.getByText('Activity', { exact: true })).toBeVisible()
    await expect(page.getByText('Start', { exact: true })).toBeVisible()
    await expect(page.getByText('End', { exact: true })).toHaveCount(0)
    await expect(page.getByText('End address')).toHaveCount(0)
    const activityIcon = await page.locator('svg[aria-hidden="true"]').first().innerHTML()

    expect(stayIcon).not.toBe(transportIcon)
    expect(transportIcon).not.toBe(activityIcon)
    expect(stayIcon).not.toBe(activityIcon)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
