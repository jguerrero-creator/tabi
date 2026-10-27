import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { activitySeed } from './support/reservationSeeds'

// TABI-55 — "Vue Budget agrégée automatiquement depuis les réservations". Spec:
// "Somme automatique des prix renseignés sur les réservations et activités
// bookmarkées, groupée par catégorie (hébergement/transport/activités)." Seeds one
// priced and one unpriced reservation per type under the same trip and verifies the
// Budget screen shows the correct grand total, per-category totals, the partial-price
// hint (since one reservation of the three has no price), and that an unpriced trip
// shows the empty state instead of a zeroed-out summary.

const START_AT = '2026-09-01T10:00:00.000Z'
const END_AT = '2026-09-01T14:00:00.000Z'

test('budget screen sums prices by category and flags partially-priced trips', async ({ page, registerTrip }) => {
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
  registerTrip(client, trip.id)

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
      activitySeed({ trip_id: trip.id, type: 'activity', name: `E2E budget activity ${runId}`, start_at: START_AT, end_at: null }),
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

// Budget/Souvenirs merge (Backlog: "fusionner Souvenirs et supprimer l'onglet
// Souvenirs"). Souvenirs becomes its own category in the "By category" accordion,
// built from souvenir_items.amount rather than from reservations: every item counts
// toward the total regardless of is_checked (it's a planned budget, not a spent
// ledger), an empty amount counts as nothing (never defaulted to 0), and — unlike
// Stay — the souvenirs total is never divided by traveler count.
test('budget screen folds the souvenirs checklist into the grand total as its own category', async ({
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
      name: `E2E souvenirs budget trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const { error: souvenirsError } = await client.from('souvenir_items').insert([
      // Unchecked, priced — the ordinary case.
      { trip_id: trip.id, label: `Matcha ${runId}`, amount: 20, is_checked: false },
      // Checked, priced — still counts toward the total (decision #4: planned, not spent).
      { trip_id: trip.id, label: `Keychain ${runId}`, amount: 10, is_checked: true },
      // No amount entered — counts as nothing, not as 0 (decision #6).
      { trip_id: trip.id, label: `Undecided gift ${runId}`, amount: null, is_checked: false },
    ])
    if (souvenirsError) throw souvenirsError

    await page.goto(`/trips/${trip.id}/budget`)

    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    // 20 + 10 + 0 = 30, with no reservations at all contributing. Scoped to the
    // teal total banner itself — the same $30.00 also appears on the souvenirs
    // category row below since it's the only category in this trip.
    const totalBanner = page.locator('section').filter({ hasText: 'Total entered so far' })
    await expect(totalBanner).toBeVisible()
    await expect(totalBanner.getByText('$30.00')).toBeVisible()

    // Scoped to the category list itself — "Souvenirs" is also a nav link in
    // the sidebar/bottom nav on this same screen (still present in this push).
    const categoryList = page.getByRole('list')
    await expect(categoryList.getByText('Souvenirs', { exact: true })).toBeVisible()
    await expect(categoryList.getByText('3 items')).toBeVisible()
    await expect(categoryList.getByText('$30.00')).toBeVisible()

    const souvenirsToggle = page.getByRole('button', { name: /Souvenirs/ })
    await expect(souvenirsToggle).toHaveAttribute('aria-expanded', 'false')
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/souvenirs-budget-collapsed-desktop.png',
      fullPage: true,
    })

    await souvenirsToggle.click()
    await expect(souvenirsToggle).toHaveAttribute('aria-expanded', 'true')

    // The checklist renders inline — same checkboxes/name/amount as the standalone screen.
    await expect(page.getByText(`Matcha ${runId}`)).toBeVisible()
    await expect(page.getByText(`Keychain ${runId}`)).toBeVisible()
    await expect(page.getByText(`Undecided gift ${runId}`)).toBeVisible()
    await expect(page.getByText('$20.00')).toBeVisible()
    await expect(page.getByText('$10.00')).toBeVisible()
    await expect(page.getByText('No amount entered')).toBeVisible()
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/souvenirs-budget-expanded-desktop.png',
      fullPage: true,
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/souvenirs-budget-expanded-mobile-390.png',
      fullPage: true,
    })
  } finally {
    const { error: deleteSouvenirsError } = await client.from('souvenir_items').delete().eq('trip_id', trip.id)
    if (deleteSouvenirsError) throw deleteSouvenirsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('budget screen shows the empty state when the trip has no reservations', async ({ page, registerTrip }) => {
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
  registerTrip(client, trip.id)

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
