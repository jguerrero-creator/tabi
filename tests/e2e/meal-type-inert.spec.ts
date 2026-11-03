import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { mealSeed } from './support/reservationSeeds'

// Backlog: "Nouveau type de réservation Repas (Meal)" — Step 3. The database (Step 2) and
// the type-aware code (this step) both now know about 'meal', but there is still NO user
// entry point anywhere (mainTypeOptions, the nav tabs, App.tsx's routes, SavePlaceModal and
// OverviewScreen's hardcoded 'activity' literal are all deliberately untouched). This file
// proves both halves of that claim:
//  - a Meal reservation that exists (seeded directly, the only way one can exist today)
//    never crashes anything it touches — Planning, its own detail screen, Budget;
//  - nobody can actually create one through the UI yet.

async function createTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, name: string) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({
      organizer_id: user.id,
      name,
      start_date: '2026-09-10',
      end_date: '2026-09-16',
      currency: 'USD',
    })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

async function cleanupTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, tripId: string) {
  await client.from('reservations').delete().eq('trip_id', tripId)
  await client.from('trips').delete().eq('id', tripId)
}

test('a seeded Meal reservation never crashes Planning, its detail screen, or Budget — and Budget silently (and incompletely) ignores it', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal inert trip ${runId}`)
  registerTrip(client, trip.id)
  const mealName = `E2E meal ${runId}`

  try {
    const { data: meal, error } = await client
      .from('reservations')
      .insert(
        mealSeed({
          trip_id: trip.id,
          type: 'meal',
          name: mealName,
          status: 'to_book',
          start_at: '2026-09-12T12:00:00.000Z',
          start_timezone: 'UTC',
          end_at: '2026-09-12T13:00:00.000Z',
          end_timezone: 'UTC',
          price_amount: 42,
          price_currency: 'USD',
        }),
      )
      .select()
      .single()
    if (error || !meal) throw error ?? new Error('Meal insert returned no row')

    // --- Planning: renders the card, violet icon, no crash, no literal "undefined". ---
    // Checked at both 1440px desktop and 390px mobile — the shared screenshots are also
    // the real-browser evidence for Step 3's deliverable (5)(d).
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/trips/${trip.id}?tab=planning&day=2026-09-12`)
    // Scoped to the specific reservation row (role=listitem) rather than a bare text
    // match — the name text itself resolves to many DOM nodes at this viewport (day-pill
    // previews etc., mostly CSS-hidden), but there is exactly one real card for it.
    const mealCardDesktop = page.getByRole('listitem').filter({ hasText: mealName })
    await expect(mealCardDesktop).toBeVisible()
    // Confirms reservationLegLabels.meal (Step 3) rendered correctly, not "undefined ·".
    await expect(mealCardDesktop.getByText('Start · 12:00')).toBeVisible()
    await expect(page.getByText('undefined', { exact: false })).toHaveCount(0)
    // reservationTypeTextClasses.meal = 'text-violet-600' — scoped to this card's own icon.
    await expect(mealCardDesktop.locator('.text-violet-600')).toBeVisible()
    await expect(mealCardDesktop.locator('.text-violet-600 svg')).toBeVisible()
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-inert-planning-1440.png',
    })

    await page.setViewportSize({ width: 390, height: 844 })
    const mealCardMobile = page.getByRole('listitem').filter({ hasText: mealName })
    await expect(mealCardMobile).toBeVisible()
    await expect(page.getByText('undefined', { exact: false })).toHaveCount(0)
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-inert-planning-390.png',
    })

    // --- Detail screen: opens, shows the "Meal" type badge (violet), no crash. ---
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/reservations/${meal.id}`)
    await expect(page.getByRole('heading', { name: mealName })).toBeVisible()
    await expect(page.getByText('Meal', { exact: true })).toBeVisible()
    await expect(page.locator('.bg-violet-50.text-violet-600')).toBeVisible()
    await expect(page.getByText('undefined', { exact: false })).toHaveCount(0)
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-inert-detail-1440.png',
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('heading', { name: mealName })).toBeVisible()
    await expect(page.getByText('Meal', { exact: true })).toBeVisible()
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-inert-detail-390.png',
    })
    await page.setViewportSize({ width: 1440, height: 900 })

    // --- Budget: no crash, but the $42 Meal is invisible from BOTH the category list
    // AND the grand total — categoryOrder (computeBudgetSummary.ts) doesn't list 'meal'
    // yet, so it's excluded from `categories` (hence from `total`) entirely, while
    // `count` is `reservations.length` (every trip reservation, meal included). The
    // result isn't just "absent" — it's actively misleading: the total banner reads
    // $0.00 (the $42 price is nowhere), and the partial-price hint reads "0 of 1
    // reservations have a price entered" even though the one reservation that exists
    // DOES have a price. Flagging precisely for whoever does Step 6 (Budget/Meal).
    await page.goto(`/trips/${trip.id}/budget`)
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
    await expect(page.getByText('undefined', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Total entered so far')).toBeVisible()
    await expect(page.getByText('$0.00')).toBeVisible()
    await expect(page.getByText('0 of 1 reservations have a price entered')).toBeVisible()
    // "By category" still renders its own header (summary.count > 0 is true — the meal
    // IS counted there) but with zero rows under it, since every one of the three
    // categories that actually get listed (stay/transport/activity) has 0 items.
    await expect(page.getByText('By category')).toBeVisible()
    const categoryList = page.getByRole('list')
    await expect(categoryList.getByText('Meal', { exact: true })).toHaveCount(0)
    await expect(categoryList.getByRole('listitem')).toHaveCount(0)
    await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-inert-budget.png' })
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('nobody can create a Meal yet: the Add form type selector and navigation are unchanged', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal no-entry-point trip ${runId}`)
  registerTrip(client, trip.id)

  try {
    // Desktop sidebar: still exactly 5 tabs, no "Meals" entry.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/trips/${trip.id}`)
    const sidebarNav = page.locator('aside nav')
    await expect(sidebarNav.getByRole('link')).toHaveCount(5)
    await expect(sidebarNav.getByRole('link', { name: 'Meals', exact: true })).toHaveCount(0)

    // Mobile bottom nav: same, still 5.
    await page.setViewportSize({ width: 390, height: 844 })
    const bottomNav = page.locator('nav.fixed')
    await expect(bottomNav.getByRole('link')).toHaveCount(5)
    await expect(bottomNav.getByRole('link', { name: 'Meals', exact: true })).toHaveCount(0)

    // The Add Reservation form's own type selector: still only Stay/Transport/Activity.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/trips/${trip.id}/stay`)
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.getByRole('button', { name: 'Change type' }).click()
    const typeSelect = page.getByLabel('Type')
    const optionLabels = await typeSelect.locator('option').allTextContents()
    expect(optionLabels.sort()).toEqual(['Activity', 'Stay', 'Transport'])
  } finally {
    await cleanupTrip(client, trip.id)
  }
})
