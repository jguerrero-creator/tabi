import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-55 — "Vue Budget agrégée automatiquement depuis les réservations". Spec:
// "Somme automatique des prix renseignés sur les réservations et activités
// bookmarkées, groupée par catégorie (hébergement/transport/activités)." Seeds one
// priced and one unpriced reservation per type under the same trip and verifies the
// Budget screen shows the correct grand total, per-category totals, the partial-price
// hint (since one reservation of the three has no price), and that an unpriced trip
// shows the empty state instead of a zeroed-out summary.

const START_AT = '2026-09-01T10:00:00.000Z'
const END_AT = '2026-09-01T14:00:00.000Z'

test('budget screen sums prices by category and flags partially-priced trips', async ({ page }) => {
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
      name: `E2E budget trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const { error: reservationsError } = await client.from('reservations').insert([
      {
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: `E2E budget stay ${runId}`,
        start_at: START_AT,
        end_at: END_AT,
        price_amount: 150,
        price_currency: 'USD',
      },
      {
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        name: `E2E budget transport ${runId}`,
        start_at: START_AT,
        start_timezone: 'Europe/Paris',
        end_at: END_AT,
        end_timezone: 'Europe/Paris',
        price_amount: 50,
        price_currency: 'USD',
      },
      // Deliberately unpriced — exercises the "N of M reservations have a price
      // entered" partial hint rather than being silently dropped from the count.
      { trip_id: trip.id, type: 'activity', name: `E2E budget activity ${runId}`, start_at: START_AT, end_at: null },
    ])
    if (reservationsError) throw reservationsError

    await page.goto(`/trips/${trip.id}/budget`)

    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    await expect(page.getByText('Total entered so far')).toBeVisible()
    await expect(page.getByText('$200.00')).toBeVisible()
    await expect(page.getByText('2 of 3 reservations have a price entered')).toBeVisible()

    await expect(page.getByText('By category')).toBeVisible()
    // Scoped to the category list itself — "Stay"/"Transport"/"Activity" also
    // appear as nav links in the sidebar/bottom nav on this same screen.
    const categoryList = page.getByRole('list')
    await expect(categoryList.getByText('Stay', { exact: true })).toBeVisible()
    await expect(categoryList.getByText('$150.00')).toBeVisible()
    await expect(categoryList.getByText('Transport', { exact: true })).toBeVisible()
    await expect(categoryList.getByText('$50.00')).toBeVisible()
    // Unpriced activity still counts as an item under its category, just contributes $0.
    const activityRow = page.getByRole('listitem').filter({ hasText: 'Activity' })
    await expect(activityRow).toBeVisible()
    await expect(activityRow.getByText('1 item')).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('budget screen shows the empty state when the trip has no reservations', async ({ page }) => {
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
      name: `E2E budget empty trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    await page.goto(`/trips/${trip.id}/budget`)

    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    await expect(page.getByText('No prices entered yet')).toBeVisible()
    await expect(page.getByText('Total entered so far')).toHaveCount(0)
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
