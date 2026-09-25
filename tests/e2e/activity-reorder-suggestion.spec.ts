import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Mobile viewport: renders a single day's rail directly (no desktop multi-column
// carousel to disambiguate against), matching this suite's existing convention for
// single-day-rail assertions (see planning-back-preserves-day.spec.ts).
test.use({ viewport: { width: 390, height: 844 } })

// TABI-76 — "Optimisation automatique de l'ordre des activités d'une journée". When 3+
// untimed (start_time_is_default) Activities share a day, the app should suggest a
// reordering that meaningfully cuts total travel time — suggested only, never applied
// without confirmation. Four stops laid out on a line (A-B-C-D, 0.1° apart) are seeded in
// a zig-zag creation order (A, C, B, D) so the optimal order (A, B, C, D) is unambiguous;
// /api/travel-time is mocked to a simple "600s per 0.1° of latitude" model so the expected
// savings are exact and don't depend on live Google Maps data.

const STOP_LAT = { A: 35.0, B: 35.1, C: 35.2, D: 35.3 }
const STOP_LNG = 139.0

function mockTravelTimeRoute(page: import('@playwright/test').Page) {
  return page.route('**/api/travel-time', async (route) => {
    const body = route.request().postDataJSON() as { origin: { lat: number }; destination: { lat: number } }
    const durationSeconds = Math.round(Math.abs(body.origin.lat - body.destination.lat) * 6000)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ durationSeconds, distanceMeters: durationSeconds * 20, hasDirectTransfer: false }),
    })
  })
}

test('suggests reordering untimed activities, dismiss leaves order untouched, apply reorders them', async ({
  page,
  registerTrip,
}) => {
  await mockTravelTimeRoute(page)

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
      name: `E2E activity reorder trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-10',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // Seeded in zig-zag order A, C, B, D (by start_at) — current total travel 1200+600+1200=3000s,
    // vs. the optimal A,B,C,D order's 600+600+600=1800s (a 1200s / 40% improvement, comfortably
    // over both the absolute 10-min and relative 15% suggestion thresholds).
    const stops: { label: 'A' | 'C' | 'B' | 'D'; startAt: string }[] = [
      { label: 'A', startAt: '2026-09-10T00:00:00.000Z' },
      { label: 'C', startAt: '2026-09-10T00:01:00.000Z' },
      { label: 'B', startAt: '2026-09-10T00:02:00.000Z' },
      { label: 'D', startAt: '2026-09-10T00:03:00.000Z' },
    ]
    const activityIds: Record<string, string> = {}
    for (const stop of stops) {
      const { data, error } = await client
        .from('reservations')
        .insert({
          trip_id: trip.id,
          type: 'activity',
          name: `E2E Activity ${stop.label}`,
          status: 'to_book',
          start_at: stop.startAt,
          end_at: null,
          start_time_is_default: true,
          start_address: `Stop ${stop.label}, Test City`,
          start_lat: STOP_LAT[stop.label],
          start_lng: STOP_LNG,
          start_place_name: `Stop ${stop.label}`,
          start_city: 'Test City',
          start_timezone: 'UTC',
        })
        .select()
        .single()
      if (error || !data) throw error ?? new Error(`Activity ${stop.label} insert returned no row`)
      activityIds[stop.label] = data.id
    }

    await page.goto(`/trips/${trip.id}?tab=planning&day=2026-09-10`)
    const mobileView = page.getByTestId('mobile-day-view')
    await expect(mobileView.getByText('E2E Activity A')).toBeVisible()
    await expect(mobileView.getByText('E2E Activity D')).toBeVisible()

    // 1. Suggestion appears with the exact expected savings (1200s = 20 min).
    await expect(page.getByText('Reorder these activities?')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Reordering these activities could save ~20 min of travel today/)).toBeVisible()

    // 2. Dismiss — no DB change, dialog closes.
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('Reorder these activities?')).toHaveCount(0)
    const { data: afterDismiss, error: afterDismissError } = await client
      .from('reservations')
      .select('id, start_at')
      .eq('trip_id', trip.id)
      .order('start_at', { ascending: true })
    if (afterDismissError) throw afterDismissError
    expect(afterDismiss?.map((r) => r.id)).toEqual([activityIds.A, activityIds.C, activityIds.B, activityIds.D])

    // 3. Reload — dismissal doesn't persist across a remount, so the same suggestion
    // reappears (it's a lightweight "don't nag again this session" guard, not a stored
    // preference) — this time, apply it.
    await page.reload()
    await expect(page.getByText('Reorder these activities?')).toBeVisible({ timeout: 15_000 })

    const reorderPatches = Promise.all(
      [activityIds.A, activityIds.B, activityIds.C, activityIds.D].map((id) =>
        page.waitForResponse(
          (res) => res.url().includes(`/rest/v1/reservations`) && res.url().includes(id) && res.request().method() === 'PATCH',
        ),
      ),
    )
    await page.getByRole('button', { name: 'Apply' }).click()
    await reorderPatches
    await expect(page.getByText('Reorder these activities?')).toHaveCount(0)

    // 4. The four activities are now chained along the line, A-B-C-D adjacent throughout —
    // either walking direction (A,B,C,D or its exact reverse) covers the same edges and thus
    // ties on total travel time, so both count as a correct optimal reorder.
    const { data: afterApply, error: afterApplyError } = await client
      .from('reservations')
      .select('id, start_at')
      .eq('trip_id', trip.id)
      .order('start_at', { ascending: true })
    if (afterApplyError) throw afterApplyError
    const finalOrder = afterApply?.map((r) => r.id)
    const forward = [activityIds.A, activityIds.B, activityIds.C, activityIds.D]
    expect([forward, [...forward].reverse()]).toContainEqual(finalOrder)
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

test('does not suggest anything for fewer than 3 untimed activities', async ({ page, registerTrip }) => {
  await mockTravelTimeRoute(page)

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
      name: `E2E activity reorder (too few) trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-10',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    for (const stop of [
      { label: 'A', startAt: '2026-09-10T00:00:00.000Z' },
      { label: 'D', startAt: '2026-09-10T00:01:00.000Z' },
    ] as const) {
      const { error } = await client.from('reservations').insert({
        trip_id: trip.id,
        type: 'activity',
        name: `E2E Activity ${stop.label}`,
        status: 'to_book',
        start_at: stop.startAt,
        end_at: null,
        start_time_is_default: true,
        start_address: `Stop ${stop.label}, Test City`,
        start_lat: STOP_LAT[stop.label],
        start_lng: STOP_LNG,
        start_place_name: `Stop ${stop.label}`,
        start_city: 'Test City',
        start_timezone: 'UTC',
      })
      if (error) throw error
    }

    await page.goto(`/trips/${trip.id}?tab=planning&day=2026-09-10`)
    const mobileView = page.getByTestId('mobile-day-view')
    await expect(mobileView.getByText('E2E Activity A')).toBeVisible()
    await expect(mobileView.getByText('E2E Activity D')).toBeVisible()

    // Give the (would-be) suggestion computation a real chance to run before asserting its absence.
    await page.waitForTimeout(3000)
    await expect(page.getByText('Reorder these activities?')).toHaveCount(0)
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
