import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { activitySeed } from './support/reservationSeeds'

// TABI-263 Steps C+B'. Assigning a souvenir to a named traveler moves money between
// the per-traveler lines without ever changing the group total ("Total entered so
// far"), persists across reload, and the whole "By traveler" section only exists
// with 2+ NAMED travelers — below that, Budget's output must be exactly what it was
// before this ticket touched anything (no section, no caption, same figures).

const START_AT = '2026-09-01T10:00:00.000Z'
const END_AT = '2026-09-01T14:00:00.000Z'

async function createTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, name: string, travelerCount: number) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, currency: 'USD', traveler_count: travelerCount })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

async function cleanupTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, tripId: string) {
  // trip_travelers and reservations both cascade from trips; souvenir_items too.
  await client.from('trips').delete().eq('id', tripId)
}

async function addNamedTraveler(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Add traveler' }).click()
  await page.getByPlaceholder('Traveler name').fill(name)
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/rest/v1/trip_travelers') && res.request().method() === 'POST'),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ])
}

test('assigning souvenirs to named travelers moves per-traveler totals, persists after reload, and the section only shows with 2+ names', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tripName = `E2E traveler budget ${runId}`
  // Stay 100, Transport 80, Activity 30, Manual 50 — matches the ticket's own worked
  // example (Base = 210) so the assertions below can use its exact numbers.
  const trip = await createTrip(client, tripName, 2)
  registerTrip(client, trip.id)

  try {
    const { error: reservationsError } = await client.from('reservations').insert([
      {
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: `Stay ${runId}`,
        start_at: START_AT,
        end_at: END_AT,
        price_amount: 100,
        price_currency: 'USD',
      },
      {
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        name: `Transport ${runId}`,
        start_at: START_AT,
        start_timezone: 'Europe/Paris',
        end_at: END_AT,
        end_timezone: 'Europe/Paris',
        price_amount: 80,
        price_currency: 'USD',
      },
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        name: `Activity ${runId}`,
        start_at: START_AT,
        end_at: null,
        price_amount: 30,
        price_currency: 'USD',
      }),
    ])
    if (reservationsError) throw reservationsError
    const { error: manualError } = await client.from('budget_categories').insert({ trip_id: trip.id, label: 'Food', amount: 50 })
    if (manualError) throw manualError
    const souvenirAName = `Souvenir A ${runId}`
    const souvenirBName = `Souvenir B ${runId}`
    const souvenirCName = `Souvenir C ${runId}`
    const { error: souvenirsError } = await client.from('souvenir_items').insert([
      { trip_id: trip.id, label: souvenirAName, amount: 20 },
      { trip_id: trip.id, label: souvenirBName, amount: 10 },
      { trip_id: trip.id, label: souvenirCName, amount: 6 }, // stays unassigned throughout
    ])
    if (souvenirsError) throw souvenirsError

    // --- Before any named travelers: no "By traveler" section at all. ---
    await page.goto(`/trips/${trip.id}/budget`)
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    const totalBanner = page.locator('section').filter({ hasText: 'Total entered so far' })
    await expect(totalBanner.getByText('$296.00')).toBeVisible() // 100+80+30+50+20+10+6 = 296
    await expect(page.getByText('By traveler', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Includes shared lodging')).toHaveCount(0)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/budget-no-names-unchanged-1440.png',
      fullPage: true,
    })

    // --- Name exactly ONE traveler: still below the 2-name threshold, still no change. ---
    await page.goto('/')
    const row = page.getByRole('listitem').filter({ hasText: tripName })
    await row.getByRole('button', { name: 'Edit trip' }).click()
    await expect(page.getByRole('heading', { name: 'Edit Trip' })).toBeVisible()
    await addNamedTraveler(page, 'Alice')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(`/trips/${trip.id}/budget`)
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    await expect(page.getByText('By traveler', { exact: true })).toHaveCount(0)

    // --- A second name crosses the threshold: the section appears. ---
    await page.goto('/')
    await row.getByRole('button', { name: 'Edit trip' }).click()
    await expect(page.getByRole('heading', { name: 'Edit Trip' })).toBeVisible()
    await addNamedTraveler(page, 'Bob')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(`/trips/${trip.id}/budget`)
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()

    const perTravelerSection = page.locator('section').filter({ hasText: 'By traveler' })
    await expect(perTravelerSection).toBeVisible()
    await expect(totalBanner.getByText('Includes shared lodging and amounts entered per person.')).toBeVisible()
    // Base = Stay/2 (50) + Transport (80) + Activity (30) + Manual (50) = 210.
    // All 3 souvenirs (36 total) still unassigned -> 18 each. Alice = Bob = 228.
    const aliceRow = perTravelerSection.getByRole('listitem').filter({ hasText: 'Alice' })
    const bobRow = perTravelerSection.getByRole('listitem').filter({ hasText: 'Bob' })
    await expect(aliceRow.getByText('$228.00')).toBeVisible()
    await expect(bobRow.getByText('$228.00')).toBeVisible()
    await expect(page.getByText('Assigning a souvenir moves money between travelers')).toBeVisible()
    // The group total itself never moves because of any of this.
    await expect(totalBanner.getByText('$296.00')).toBeVisible()

    // --- Assign souvenir A (20) to Alice: moves 10 from Bob to Alice (half of 20). ---
    await page.getByRole('button', { name: /Souvenirs/ }).click()
    const checklist = page.getByRole('list', { name: 'Souvenirs checklist' })
    const souvenirARow = checklist.getByRole('listitem').filter({ hasText: souvenirAName })
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/souvenir_items') && res.request().method() === 'PATCH'),
      souvenirARow.getByLabel('Counts in the budget of').selectOption({ label: 'Alice' }),
    ])
    // Alice: 210 + 20 (her own) + 8 (her half of the remaining 16 unassigned) = 238.
    // Bob: 210 + 0 + 8 = 218. Sum unchanged: 238+218 = 456 = 2*210 + 36.
    await expect(aliceRow.getByText('$238.00')).toBeVisible()
    await expect(bobRow.getByText('$218.00')).toBeVisible()
    await expect(totalBanner.getByText('$296.00')).toBeVisible() // still unchanged

    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/budget-per-traveler-assigned-1440.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/budget-per-traveler-assigned-390.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 320, height: 568 })
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/budget-per-traveler-assigned-320.png',
      fullPage: true,
    })
    await page.setViewportSize({ width: 1440, height: 900 })

    // --- Reload: the assignment persists. ---
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    const perTravelerSectionAfterReload = page.locator('section').filter({ hasText: 'By traveler' })
    await expect(perTravelerSectionAfterReload.getByRole('listitem').filter({ hasText: 'Alice' }).getByText('$238.00')).toBeVisible()
    await expect(perTravelerSectionAfterReload.getByRole('listitem').filter({ hasText: 'Bob' }).getByText('$218.00')).toBeVisible()
    await page.getByRole('button', { name: /Souvenirs/ }).click()
    const checklistAfterReload = page.getByRole('list', { name: 'Souvenirs checklist' })
    await expect(
      checklistAfterReload.getByRole('listitem').filter({ hasText: souvenirAName }).getByLabel('Counts in the budget of'),
    ).toHaveValue(await getTravelerId(client, trip.id, 'Alice'))

    // --- Delete Bob: back below 2 named travelers, the section disappears again. ---
    await page.goto('/')
    await row.getByRole('button', { name: 'Edit trip' }).click()
    await expect(page.getByRole('heading', { name: 'Edit Trip' })).toBeVisible()
    const travelersList = page.getByRole('list', { name: 'Named travelers' })
    const bobTravelerRow = travelersList.getByRole('listitem').filter({ hasText: 'Bob' })
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/trip_travelers') && res.request().method() === 'DELETE'),
      bobTravelerRow.getByRole('button', { name: 'Delete traveler' }).click(),
    ])
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(`/trips/${trip.id}/budget`)
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    await expect(page.getByText('By traveler', { exact: true })).toHaveCount(0)
    // Deleting a traveler never touches the stored traveler_count or the group total.
    await expect(totalBanner.getByText('$296.00')).toBeVisible()
    const { data: tripRowAfterDelete } = await client.from('trips').select('traveler_count').eq('id', trip.id).single()
    expect(tripRowAfterDelete?.traveler_count).toBe(2)
    // Bob's souvenir assignment (he had none) is moot; souvenir A's traveler_id was
    // Alice's own id, which still exists — ON DELETE SET NULL only affects rows that
    // pointed at the DELETED traveler, which none here did.
    const { data: souvenirARowDb } = await client.from('souvenir_items').select('traveler_id').eq('label', souvenirAName).single()
    expect(souvenirARowDb?.traveler_id).not.toBeNull()

    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/budget-per-traveler-nonames-1440.png',
      fullPage: true,
    })
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

async function getTravelerId(client: Awaited<ReturnType<typeof authenticatedClientFor>>, tripId: string, name: string) {
  const { data } = await client.from('trip_travelers').select('id').eq('trip_id', tripId).eq('name', name).single()
  return data?.id ?? ''
}
