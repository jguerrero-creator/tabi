import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Backlog: "Overview : section Getting around repliable, repliée par défaut, avec compteur
// des trajets à traiter". With many legs the "Getting Around" section used to take over the
// whole Overview page. This asserts: (1) the section is collapsed by default the first time a
// trip's Overview is shown, with a header counter of legs needing attention (same definition
// TripLegsSection already sorts needs-attention-first by — no second definition); (2) the
// collapsed/expanded choice persists per trip across a reload (localStorage, survives closing
// the tab, unlike TABI-200's own sessionStorage-free DB persistence which this leaves alone);
// (3) two different trips keep independent choices; (4) a trip with nothing needing attention
// shows no counter; (5) blocked storage never crashes the section, it just can't remember the
// choice; (6) collapsing does not skip or duplicate the Google Routes API calls the counter's
// correctness depends on — those are driven entirely by useTripLegs, independent of this
// section's own collapse state.

test('Getting Around collapses by default with a needs-attention counter, remembered per trip', async ({
  page,
  registerTrip,
}) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())

  // This spec is only about the section's own collapse/counter behavior, not about travel-time
  // computation itself (covered by getting-around-mode-persistence.spec.ts) — every leg below
  // either already has a persisted result (no call expected) or deliberately has none yet (Trip
  // D), so the single real call this forces is stubbed deterministically rather than depending
  // on a live Google Routes result.
  const travelTimeRequests: { mode: string }[] = []
  await page.route('**/api/travel-time', async (route) => {
    const body = route.request().postDataJSON() as { mode: string }
    travelTimeRequests.push({ mode: body.mode })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ durationSeconds: null, distanceMeters: null }) })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()

  const client = await authenticatedClientFor(page)
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  async function makeTrip(suffix: string) {
    const { data: trip, error: tripError } = await client
      .from('trips')
      .insert({
        organizer_id: user.id,
        name: `E2E getting-around collapse ${suffix} ${runId}`,
        start_date: '2026-09-10',
        end_date: '2026-09-16',
        currency: 'USD',
        day_start_time: '08:00',
        day_end_time: '22:00',
      })
      .select()
      .single()
    if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
    registerTrip(client, trip.id)
    return trip
  }

  async function insertStay(tripId: string, name: string, city: string, lat: number, lng: number, startAt: string, endAt: string) {
    const { data, error } = await client
      .from('reservations')
      .insert({
        trip_id: tripId,
        type: 'stay',
        stay_subtype: 'hotel',
        name,
        status: 'booked',
        start_at: startAt,
        end_at: endAt,
        start_address: `${city} Station, ${city}, Japan`,
        start_lat: lat,
        start_lng: lng,
        start_place_name: `${city} Station`,
        start_city: city,
        start_timezone: 'Asia/Tokyo',
      })
      .select()
      .single()
    if (error || !data) throw error ?? new Error(`${name} insert returned no row`)
    return data
  }

  const toggleButton = page.getByRole('button', { name: /Getting around/ })

  // --- Trip A: one resolved leg (persisted) + one no-mode leg -> 1 needs attention. ---
  const tripA = await makeTrip('A')
  const a1 = await insertStay(tripA.id, 'E2E A Tokyo', 'Tokyo', 35.6812, 139.7671, '2026-09-10T00:00:00.000Z', '2026-09-11T01:00:00.000Z')
  const a2 = await insertStay(tripA.id, 'E2E A Osaka', 'Osaka', 34.7024, 135.4959, '2026-09-11T06:00:00.000Z', '2026-09-12T01:00:00.000Z')
  await insertStay(tripA.id, 'E2E A Kyoto', 'Kyoto', 35.0116, 135.7681, '2026-09-12T06:00:00.000Z', '2026-09-13T01:00:00.000Z')
  const { error: modeAError } = await client.from('trip_leg_travel_modes').insert({
    trip_id: tripA.id,
    from_reservation_id: a1.id,
    to_reservation_id: a2.id,
    mode: 'DRIVE',
    duration_seconds: 9000,
    distance_meters: 450000,
    has_direct_transfer: false,
    computed_at: new Date().toISOString(),
    dismissed_at: null,
  })
  if (modeAError) throw modeAError
  // A2 -> A3 is left with no mode picked at all: the 1 leg needing attention.

  await page.goto(`/trips/${tripA.id}`)

  // 1. Fresh trip, no stored choice: collapsed, counter shows the right number.
  await expect(toggleButton).toBeVisible()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
  await expect(toggleButton).toHaveText(/1 needs attention/)
  await expect(page.getByText('E2E A Tokyo → E2E A Osaka')).not.toBeVisible()
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/90d2672e-577e-48e7-9866-50fb1b09a671/scratchpad/screenshots/01-fresh-collapsed.png' })

  // 2. Expand: the legs show, ordered needs-attention-first; the counter is still there.
  await toggleButton.click()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
  await expect(toggleButton).toHaveText(/1 needs attention/)
  await expect(page.getByText('E2E A Tokyo → E2E A Osaka')).toBeVisible()
  const legItems = page.getByRole('listitem')
  const textsExpanded = await legItems.allInnerTexts()
  const noModeIndex = textsExpanded.findIndex((t) => t.includes('E2E A Osaka') && t.includes('E2E A Kyoto'))
  const resolvedIndex = textsExpanded.findIndex((t) => t.includes('E2E A Tokyo') && t.includes('E2E A Osaka'))
  expect(noModeIndex).toBeGreaterThanOrEqual(0)
  expect(resolvedIndex).toBeGreaterThanOrEqual(0)
  expect(noModeIndex).toBeLessThan(resolvedIndex)
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/90d2672e-577e-48e7-9866-50fb1b09a671/scratchpad/screenshots/02-expanded.png' })

  // Reload: stays expanded.
  await page.reload()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('E2E A Tokyo → E2E A Osaka')).toBeVisible()

  // Collapse, reload: stays collapsed.
  await toggleButton.click()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('E2E A Tokyo → E2E A Osaka')).not.toBeVisible()
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/90d2672e-577e-48e7-9866-50fb1b09a671/scratchpad/screenshots/03-collapsed-after-reload.png' })

  // Keyboard: Enter and Space toggle it, the focus ring is visible.
  await toggleButton.focus()
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/90d2672e-577e-48e7-9866-50fb1b09a671/scratchpad/screenshots/04-focus-ring.png' })
  await page.keyboard.press('Enter')
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Space')
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'false')

  // --- Trip B: both legs already resolved -> 0 needs attention -> no counter, independent of A. ---
  const tripB = await makeTrip('B')
  const b1 = await insertStay(tripB.id, 'E2E B Tokyo', 'Tokyo', 35.6812, 139.7671, '2026-09-10T00:00:00.000Z', '2026-09-11T01:00:00.000Z')
  const b2 = await insertStay(tripB.id, 'E2E B Osaka', 'Osaka', 34.7024, 135.4959, '2026-09-11T06:00:00.000Z', '2026-09-12T01:00:00.000Z')
  const { error: modeBError } = await client.from('trip_leg_travel_modes').insert({
    trip_id: tripB.id,
    from_reservation_id: b1.id,
    to_reservation_id: b2.id,
    mode: 'DRIVE',
    duration_seconds: 9000,
    distance_meters: 450000,
    has_direct_transfer: false,
    computed_at: new Date().toISOString(),
    dismissed_at: null,
  })
  if (modeBError) throw modeBError

  await page.goto(`/trips/${tripB.id}`)
  await expect(toggleButton).toBeVisible()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
  // 5. A trip with no legs needing attention: no counter.
  await expect(toggleButton).not.toHaveText(/need/)
  await toggleButton.click()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/90d2672e-577e-48e7-9866-50fb1b09a671/scratchpad/screenshots/05-trip-b-no-counter-expanded.png' })

  // Trip B was just expanded; going back to trip A must still reflect A's own last choice
  // (collapsed, from above) — the two trips' choices are independent.
  await page.goto(`/trips/${tripA.id}`)
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
  await page.goto(`/trips/${tripB.id}`)
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'true')

  // --- Trip C: no reservations at all -> no legs -> section isn't rendered. ---
  const tripC = await makeTrip('C')
  await page.goto(`/trips/${tripC.id}`)
  await expect(page.getByRole('main')).toBeVisible()
  await expect(toggleButton).toHaveCount(0)

  // --- Trip D: storage blocked for this feature's key -> no crash, default (collapsed) state. ---
  const tripD = await makeTrip('D')
  const d1 = await insertStay(tripD.id, 'E2E D Tokyo', 'Tokyo', 35.6812, 139.7671, '2026-09-10T00:00:00.000Z', '2026-09-11T01:00:00.000Z')
  const d2 = await insertStay(tripD.id, 'E2E D Osaka', 'Osaka', 34.7024, 135.4959, '2026-09-11T06:00:00.000Z', '2026-09-12T01:00:00.000Z')
  // Mode already picked but not yet computed — mirrors the instant right after a user picks a
  // mode: useTripLegs must still fire a real Routes API call for it, collapsed or not.
  const { error: modeDError } = await client.from('trip_leg_travel_modes').insert({
    trip_id: tripD.id,
    from_reservation_id: d1.id,
    to_reservation_id: d2.id,
    mode: 'DRIVE',
    duration_seconds: null,
    distance_meters: null,
    has_direct_transfer: false,
    computed_at: null,
    dismissed_at: null,
  })
  if (modeDError) throw modeDError

  await page.addInitScript(() => {
    const original = { getItem: window.localStorage.getItem.bind(window.localStorage), setItem: window.localStorage.setItem.bind(window.localStorage) }
    window.localStorage.getItem = (key: string) => {
      if (key.startsWith('tabi:tripLegsCollapsed:')) throw new Error('storage blocked (simulated)')
      return original.getItem(key)
    }
    window.localStorage.setItem = (key: string, value: string) => {
      if (key.startsWith('tabi:tripLegsCollapsed:')) throw new Error('storage blocked (simulated)')
      return original.setItem(key, value)
    }
  })

  const driveRequestCountBefore = travelTimeRequests.filter((r) => r.mode === 'DRIVE').length
  await page.goto(`/trips/${tripD.id}`)
  // 6a. No crash: the app still renders, section still shows, still collapsed by default.
  await expect(page.getByRole('main')).toBeVisible()
  await expect(toggleButton).toBeVisible()
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
  // 6b. The counter still becomes correct — the Routes call the counter depends on happens
  // even while collapsed (it's driven by useTripLegs, not by this section's open/closed state).
  await expect(toggleButton).toHaveText(/1 needs attention/, { timeout: 15_000 })
  // At least one real call happened despite the section being collapsed — it was not skipped.
  // (Not asserted as exactly +1: React StrictMode's dev-only double-effect-invocation can fire
  // this same request twice on a fresh mount regardless of collapse state — a pre-existing
  // useTripLegs quirk unrelated to this feature, see the report alongside this spec.)
  expect(travelTimeRequests.filter((r) => r.mode === 'DRIVE').length).toBeGreaterThanOrEqual(driveRequestCountBefore + 1)
  const driveRequestCountAfterLoad = travelTimeRequests.filter((r) => r.mode === 'DRIVE').length
  // Toggling collapse open/closed a few times must not trigger any further Routes calls.
  await toggleButton.click()
  await toggleButton.click()
  await toggleButton.click()
  await page.waitForTimeout(1000)
  expect(travelTimeRequests.filter((r) => r.mode === 'DRIVE').length).toBe(driveRequestCountAfterLoad)
  // Clicking still works for this render even though the write throws (just doesn't persist).
  await expect(toggleButton).toHaveAttribute('aria-expanded', 'true')

  // --- Mobile / desktop viewports (trip A). ---
  await page.goto(`/trips/${tripA.id}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/90d2672e-577e-48e7-9866-50fb1b09a671/scratchpad/screenshots/06-mobile-390.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/90d2672e-577e-48e7-9866-50fb1b09a671/scratchpad/screenshots/07-desktop-1440.png' })
})
