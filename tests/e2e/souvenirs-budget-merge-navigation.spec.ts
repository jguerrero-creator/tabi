import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Backlog: "Budget : fusionner Souvenirs (checklist avec montant par souvenir) et
// supprimer l'onglet Souvenirs" — Push B. The Souvenirs tab is gone (6 → 5 nav
// entries, mobile bottom nav and desktop sidebar), and the old
// /trips/:tripId/souvenirs route now redirects to the trip's Budget instead of
// 404ing, so existing links/bookmarks keep working. This covers: the nav entry
// count and absence of a layout gap at two mobile widths, the desktop sidebar,
// and the redirect itself — including that it's a `replace` (no back-button
// bounce between the old and new routes).

async function enableMealsSwitch(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('tabi.feature.meals', '1'))
}

async function makeTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, suffix: string) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: trip, error } = await client
    .from('trips')
    .insert({
      organizer_id: user.id,
      name: `E2E souvenirs-removed nav ${suffix} ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

test('bottom nav and desktop sidebar drop to 5 entries with no Souvenirs tab, and no layout gap at 390px/320px', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const trip = await makeTrip(client, 'A')
  registerTrip(client, trip.id)

  await page.goto(`/trips/${trip.id}`)

  // Desktop sidebar: exactly 5 nav links, Souvenirs gone, Budget still there.
  await page.setViewportSize({ width: 1440, height: 900 })
  const sidebarNav = page.locator('aside nav')
  await expect(sidebarNav.getByRole('link')).toHaveCount(5)
  await expect(sidebarNav.getByRole('link', { name: 'Souvenirs' })).toHaveCount(0)
  await expect(sidebarNav.getByRole('link', { name: 'Budget' })).toBeVisible()
  await page.screenshot({
    path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/push-b-desktop-sidebar-1440.png',
  })

  // Mobile bottom nav at 390px: exactly 5 links, evenly spaced (each flex-1 — no
  // leftover gap from a 6-column layout), Souvenirs gone.
  await page.setViewportSize({ width: 390, height: 844 })
  const bottomNav = page.locator('nav.fixed')
  await expect(bottomNav.getByRole('link')).toHaveCount(5)
  await expect(bottomNav.getByRole('link', { name: 'Souvenirs' })).toHaveCount(0)
  const widths390 = await bottomNav.getByRole('link').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  expect(Math.max(...widths390) - Math.min(...widths390)).toBeLessThan(1)
  await page.screenshot({
    path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/push-b-bottom-nav-390.png',
  })

  // Same check at a narrower 320px width.
  await page.setViewportSize({ width: 320, height: 760 })
  await expect(bottomNav.getByRole('link')).toHaveCount(5)
  const widths320 = await bottomNav.getByRole('link').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  expect(Math.max(...widths320) - Math.min(...widths320)).toBeLessThan(1)
  // The row of 5 links must fill the viewport width exactly (no leftover gap on
  // the right from flex-basis math left over from a 6-item layout).
  const navBox = await bottomNav.boundingBox()
  expect(navBox).not.toBeNull()
  expect(Math.abs((navBox?.width ?? 0) - 320)).toBeLessThan(1)
  await page.screenshot({
    path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/push-b-bottom-nav-320.png',
  })
})

test('the old Souvenirs route redirects to Budget (replace — no back-button bounce)', async ({ page, registerTrip }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const trip = await makeTrip(client, 'B')
  registerTrip(client, trip.id)

  // Simulate an old bookmark/link straight to the removed route.
  await page.goto(`/trips/${trip.id}`)
  await page.goto(`/trips/${trip.id}/souvenirs`)

  await expect(page).toHaveURL(`/trips/${trip.id}/budget`)
  await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible()
  await page.screenshot({
    path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/push-b-old-url-lands-on-budget.png',
  })

  // `replace`, not `push`: the /souvenirs history entry was swapped out, not
  // stacked on top, so Back must land on Overview, not bounce back to /souvenirs.
  await page.goBack()
  await expect(page).toHaveURL(`/trips/${trip.id}`)
})

// Step 5 (Meal plan): with the feature switch ON, a 6th "Meals" entry appears (violet
// fork-and-knife icon) — everything above this test asserts the OFF state is still
// exactly 5; this is the complementary ON assertion the Meal plan's checklist calls for.
test('switch ON: bottom nav and desktop sidebar show 6 entries including Meals, still no layout gap at 390px/320px', async ({
  page,
  registerTrip,
}) => {
  await enableMealsSwitch(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const trip = await makeTrip(client, 'C')
  registerTrip(client, trip.id)

  await page.goto(`/trips/${trip.id}`)

  await page.setViewportSize({ width: 1440, height: 900 })
  const sidebarNav = page.locator('aside nav')
  await expect(sidebarNav.getByRole('link')).toHaveCount(6)
  // Nav icons inherit color from the Link's own active/inactive state (teal/slate), same
  // as every other tab today — no per-type color in the nav itself, just the glyph shape.
  await expect(sidebarNav.getByRole('link', { name: 'Meals' })).toBeVisible()
  await expect(sidebarNav.getByRole('link', { name: 'Meals' }).locator('svg')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const bottomNav = page.locator('nav.fixed')
  await expect(bottomNav.getByRole('link')).toHaveCount(6)
  await expect(bottomNav.getByRole('link', { name: 'Meals' })).toBeVisible()
  const widths390 = await bottomNav.getByRole('link').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  expect(Math.max(...widths390) - Math.min(...widths390)).toBeLessThan(1)

  await page.setViewportSize({ width: 320, height: 760 })
  await expect(bottomNav.getByRole('link')).toHaveCount(6)
  const widths320 = await bottomNav.getByRole('link').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))
  expect(Math.max(...widths320) - Math.min(...widths320)).toBeLessThan(1)
  const navBox = await bottomNav.boundingBox()
  expect(navBox).not.toBeNull()
  expect(Math.abs((navBox?.width ?? 0) - 320)).toBeLessThan(1)
  // Even spacing/full-width hold at 320px (asserted above) — but a real screenshot at
  // this width shows "Transport"/"Activities" visually crowding together with no gap
  // between labels. Flagged to the user rather than guessing at a fix (icon-only below
  // a breakpoint, shorter labels, etc.) — see the Step 5 report.
})
