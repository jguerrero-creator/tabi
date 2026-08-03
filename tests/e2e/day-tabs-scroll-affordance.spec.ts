import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// TABI-139 — the day-tab pill row in Planning is horizontally scrollable, but
// plain overflow-x-auto isn't discoverable enough on its own. A fading
// chevron must appear on whichever edge still has hidden pills and disappear
// once that edge is reached. Uses a narrow (mobile) viewport, since the pill
// row only renders in the `lg:hidden` single-day view — the desktop layout
// shows every day at once as a row of columns (TABI-149) and has no scroll
// affordance to test.
test.use({ viewport: { width: 390, height: 720 } })

test('Day-tab pill row shows a scroll-edge chevron only on sides with hidden days', async ({ page, registerTrip }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // A 20-day range with no reservations — TABI-139's own correction means the
  // pill row is built from the trip's date span, not from booked days, and a
  // 390px-wide viewport can't fit 20 pills without overflow either way.
  const { data: trip, error: tripError } = await client
    .from('trips')
    .insert({
      organizer_id: user.id,
      name: `E2E day-tabs scroll ${runId}`,
      start_date: '2026-09-01',
      end_date: '2026-09-20',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    await expect(page.getByRole('button', { name: 'Sep 1', exact: true })).toBeVisible()

    const scrollRow = page.getByTestId('day-tabs-scroll')
    const leftChevron = page.getByTestId('day-tabs-chevron-left')
    const rightChevron = page.getByTestId('day-tabs-chevron-right')

    // At the leftmost scroll position, only the trailing (right) chevron
    // signals hidden days.
    await expect(leftChevron).toHaveCount(0)
    await expect(rightChevron).toBeVisible()

    // Scroll fully to the right end.
    await scrollRow.evaluate((el) => {
      el.scrollLeft = el.scrollWidth
    })
    await expect(rightChevron).toHaveCount(0)
    await expect(leftChevron).toBeVisible()

    // Scroll to the middle — both edges have hidden pills.
    await scrollRow.evaluate((el) => {
      el.scrollLeft = el.scrollWidth / 2
    })
    await expect(leftChevron).toBeVisible()
    await expect(rightChevron).toBeVisible()
  } finally {
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
