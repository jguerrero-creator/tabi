import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-57 — "Budgets manuels par catégorie". Spec: "Catégories libres (ex:
// nourriture/jour, divers/souvenirs) avec un montant estimé saisi
// manuellement, additionnées au total du budget agrégé." Covers a manual
// category folded into the TABI-55 grand total alongside a priced
// reservation, adding/deleting a category through the UI, and a trip with
// only manual categories (no reservations) still showing its total instead
// of the empty state.

const START_AT = '2026-09-01T10:00:00.000Z'
const END_AT = '2026-09-01T14:00:00.000Z'

test('budget screen folds manual categories into the grand total', async ({ page, registerTrip }) => {
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
      name: `E2E manual budget trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: reservationError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      name: `E2E manual budget stay ${runId}`,
      start_at: START_AT,
      end_at: END_AT,
      price_amount: 150,
      price_currency: 'USD',
    })
    if (reservationError) throw reservationError

    const { error: categoryError } = await client
      .from('budget_categories')
      .insert({ trip_id: trip.id, label: 'Food/day', amount: 40 })
    if (categoryError) throw categoryError

    await page.goto(`/trips/${trip.id}/budget`)

    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    // 150 (stay) + 40 (manual category) = 190
    await expect(page.getByText('$190.00')).toBeVisible()

    await expect(page.getByText('Manual categories')).toBeVisible()
    await expect(page.getByText('Food/day')).toBeVisible()
    await expect(page.getByText('$40.00')).toBeVisible()

    // Add a second category through the UI and confirm it joins the total.
    await page.getByRole('button', { name: 'Add category' }).click()
    await page.getByPlaceholder('e.g. Food/day, Souvenirs').fill('Souvenirs')
    await page.getByPlaceholder('Estimated amount').fill('25')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Souvenirs')).toBeVisible()
    // 150 + 40 + 25 = 215
    await expect(page.getByText('$215.00')).toBeVisible()

    // Delete the newly-added category and confirm the total drops back down.
    const souvenirsRow = page.getByRole('listitem').filter({ hasText: 'Souvenirs' })
    await souvenirsRow.getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByText('Souvenirs')).toHaveCount(0)
    await expect(page.getByText('$190.00')).toBeVisible()
  } finally {
    const { error: deleteCategoriesError } = await client.from('budget_categories').delete().eq('trip_id', trip.id)
    if (deleteCategoriesError) throw deleteCategoriesError
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('a trip with only a manual category shows its total instead of the empty state', async ({
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
      name: `E2E manual-only budget trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: categoryError } = await client
      .from('budget_categories')
      .insert({ trip_id: trip.id, label: 'Misc', amount: 60 })
    if (categoryError) throw categoryError

    await page.goto(`/trips/${trip.id}/budget`)

    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    await expect(page.getByText('No prices entered yet')).toHaveCount(0)
    await expect(page.getByText('Total entered so far')).toBeVisible()
    await expect(page.getByText('$60.00')).toHaveCount(2) // total banner + the single category row
    // No reservations, so the reservation-derived "By category" section stays hidden.
    await expect(page.getByText('By category')).toHaveCount(0)
  } finally {
    const { error: deleteCategoriesError } = await client.from('budget_categories').delete().eq('trip_id', trip.id)
    if (deleteCategoriesError) throw deleteCategoriesError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
