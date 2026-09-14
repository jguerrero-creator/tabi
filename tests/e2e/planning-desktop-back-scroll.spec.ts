import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Desktop reproduction of the reported TABI-131 regression (Bugs DB:
// "Régression TABI-131 : le retour depuis la fiche détail vers Planning ne
// conserve plus le jour sélectionné"). Julian's real usage is Chrome
// desktop — CLAUDE.md #18: "Desktop: ... Planning shows 3 days side by side
// instead of tabs" (the carousel in TripTimeline.tsx's `lg:flex` branch),
// unlike the mobile DayTabs + `?day=` URL param mechanism that
// planning-back-preserves-day.spec.ts already confirmed works. On desktop
// there is no `selectedDayKey`/URL concept at all for which day is in
// view — it's raw horizontal scroll position in an `overflow-x-auto` div,
// which a full route unmount/remount (navigating to /reservations/:id and
// back) cannot possibly preserve on its own.
test('desktop: back from a reservation detail screen restores horizontal scroll position in the day carousel', async ({
  page,
  registerTrip,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
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
    .insert({ organizer_id: user.id, name: `E2E desktop day-persist trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const DAY_COUNT = 12
    const TARGET_INDEX = 7 // day 8 of 12 (Sep 17) — comfortably reachable (see note below), and clearly not day 1 or an adjacent day.
    const day1Name = `E2E desktop day-persist activity0 ${runId}`
    const targetDayName = `E2E desktop day-persist activity${TARGET_INDEX} ${runId}`

    // 12 day-groups (Sep 10 → Sep 21) so the target day's own scroll-snap
    // point is comfortably within reach: each column is w-80 (320px) +
    // gap-4 (16px) = 336px, giving ~4016px of total scroll width against
    // ~1120px of visible carousel width at this viewport — the target
    // column's snap point (7 * 336 = 2352px) sits well under the ~2896px
    // maximum scrollLeft, unlike an earlier version of this spec that used
    // only 8 days and tried to target the *last* one: with that little
    // total width, the last column's snap point was mathematically
    // unreachable (beyond `scrollWidth - clientWidth`), so no scroll
    // gesture — real or simulated — could ever bring it flush to the left
    // edge; the browser just clamped short, landing on an earlier column
    // instead. That was a test-construction bug, not a product bug.
    for (let i = 0; i < DAY_COUNT; i++) {
      const date = new Date(Date.UTC(2026, 8, 10 + i, 6, 0, 0)).toISOString()
      const name = `E2E desktop day-persist activity${i} ${runId}`
      const { error } = await client.from('reservations').insert({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name,
        start_at: date,
        start_timezone: 'Asia/Tokyo',
        end_at: null,
      })
      if (error) throw error
    }

    await page.goto(`/trips/${trip.id}?tab=planning`)

    // Scoped to the desktop carousel — `mobile-day-view` stays in the DOM
    // (CSS `lg:hidden`, not unmounted) even at a desktop viewport, and it
    // would otherwise also match one of these two cards (whichever single
    // day it currently shows), doubling the count.
    const desktopCarousel = page.getByTestId('desktop-day-carousel')
    const day1Card = desktopCarousel.locator('a').filter({ hasText: day1Name })
    const targetCard = desktopCarousel.locator('a').filter({ hasText: targetDayName })
    await expect(day1Card).toHaveCount(1)
    await expect(targetCard).toHaveCount(1)

    // Sanity check: day 1's own card starts in view (leftmost column) and
    // the target day's does not — proves the carousel actually overflows at
    // this viewport width before we scroll it.
    await expect(day1Card).toBeInViewport()
    await expect(targetCard).not.toBeInViewport()

    // Scroll to the target column's exact snap point, computed entirely
    // within the carousel's own scroll-space (scrollWidth/children.length),
    // the same way the production fix (TripTimeline.tsx) derives its
    // column pitch — deliberately not `child.offsetLeft`, which is relative
    // to the nearest *positioned* ancestor (here, further up than the
    // carousel div itself, off by the 288px sidebar plus padding) rather
    // than the scroll container, and not `scrollIntoViewIfNeeded()`, which
    // only scrolls the minimum distance needed and can stop well short of
    // an actual column boundary since several columns fit in view at once.
    await desktopCarousel.evaluate((el, targetIndex) => {
      const pitch = el.scrollWidth / el.children.length
      el.scrollLeft = targetIndex * pitch
    }, TARGET_INDEX)
    await expect(targetCard).toBeInViewport()
    await expect(day1Card).not.toBeInViewport()

    // The scroll -> URL sync is debounced 150ms after scrolling settles;
    // give it time to land before navigating away, and confirm it landed on
    // the target day specifically (not just "some later day").
    await expect(page).toHaveURL(/day=2026-09-17/, { timeout: 2000 })

    // Open the reservation's detail screen.
    await targetCard.click()
    await expect(page.getByRole('heading', { name: targetDayName })).toBeVisible()

    // Navigate back via the in-app back arrow (the actual UI element a user clicks).
    await page.getByRole('button', { name: 'Back', exact: true }).click()

    await expect(page).toHaveURL(/tab=planning/)
    // The claim under test: the target day's card should still be scrolled
    // into view, not reset back to day 1's column. `targetCard`/`day1Card`
    // are lazy locators scoped to `desktop-day-carousel`, re-queried
    // against the freshly remounted DOM here.
    await expect(targetCard).toBeInViewport()
    await expect(day1Card).not.toBeInViewport()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
