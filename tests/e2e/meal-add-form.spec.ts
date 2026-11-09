import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { activitySeed } from './support/reservationSeeds'

// Backlog: "Nouveau type de réservation Repas (Meal)" — Step 4b. The Add form can
// create a Meal (place or checklist) ONLY while the feature switch is on
// (`tabi.feature.meals` in localStorage) — every test here turns it on explicitly via
// addInitScript. Every trip here is throwaway (never the real "Japon décembre" trip);
// Budget deliberately still ignores Meal spend until Step 6, so these tests check
// Planning and the raw DB row, not Budget.

async function enableMealsSwitch(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('tabi.feature.meals', '1'))
}

async function createTrip(
  client: Awaited<ReturnType<typeof authenticatedClientFor>>,
  name: string,
  dates?: { start_date: string; end_date: string },
) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({
      organizer_id: user.id,
      name,
      start_date: dates?.start_date ?? null,
      end_date: dates?.end_date ?? null,
      currency: 'USD',
    })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

async function cleanupTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, tripId: string) {
  await client.from('trip_day_locations').delete().eq('trip_id', tripId)
  await client.from('reservations').delete().eq('trip_id', tripId)
  await client.from('trips').delete().eq('id', tripId)
}

async function openAddFormAsMeal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Add reservation' }).click()
  await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
  await page.getByRole('button', { name: 'Change type' }).click()
  // Selecting 'meal' re-fires useReservationsByType(tripId, 'meal') (the overlap check's
  // own data source) — wait for THAT specific GET, not just generic network idleness, or
  // the overlap/location-mismatch check below can race against a still-empty/stale
  // result (seen as a flaky "no dialog" when this file's tests run back to back).
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/rest/v1/reservations') && res.url().includes('type=eq.meal') && res.request().method() === 'GET',
    ),
    page.getByLabel('Type').selectOption('meal'),
  ])
}

test('switch ON: create a place Meal (date/time/duration/price) and a checklist Meal (no status, no address)', async ({
  page,
  registerTrip,
}) => {
  await enableMealsSwitch(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal add-form ${runId}`)
  registerTrip(client, trip.id)

  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/trips/${trip.id}/stay`)

    // --- Type select offers Meal while the switch is on. ---
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await page.getByRole('button', { name: 'Change type' }).click()
    const typeSelect = page.getByLabel('Type')
    const optionLabels = await typeSelect.locator('option').allTextContents()
    expect(optionLabels.sort()).toEqual(['Activity', 'Meal', 'Stay', 'Transport'])
    await typeSelect.selectOption('meal')

    // TABI-203 suggested name (item 3): "New Meal", before it's overwritten below.
    await expect(page.getByLabel('Name')).toHaveValue('New Meal')
    // Default subtype is "Specific place" — Status/Address fields are visible.
    await expect(page.getByRole('radio', { name: 'Specific place' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('Status', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Address')).toBeVisible()

    const placeMealName = `Smoke place meal ${runId}`
    await page.getByLabel('Name').fill(placeMealName)
    await page.getByLabel('Address').fill('Tsukiji Outer Market, Chuo City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2027-06-10')
    await page.getByLabel('Start time').fill('12:30')
    await page.getByLabel('Hours').fill('1')
    await page.getByLabel('Minutes').fill('30')
    await page.getByLabel('Price').fill('45')
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-add-form-place-1440.png',
    })

    const [placeInsert] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(placeInsert.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    // --- Checklist Meal: no Status picker, no Address field. ---
    await openAddFormAsMeal(page)
    await page.getByRole('radio', { name: 'Checklist (a few options to pick from)' }).click()
    await expect(page.getByText('Status', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Address')).toHaveCount(0)
    const checklistMealName = `Smoke checklist meal ${runId}`
    await page.getByLabel('Name').fill(checklistMealName)
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-add-form-checklist-1440.png',
    })
    const [checklistInsert] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(checklistInsert.ok()).toBe(true)

    // --- DB rows, read-only (the detail screen can't edit a Meal's date yet, 4c). ---
    const { data: rows, error: fetchErr } = await client.from('reservations').select('*').eq('trip_id', trip.id)
    if (fetchErr || !rows) throw fetchErr ?? new Error('no rows')
    expect(rows).toHaveLength(2)
    const placeRow = rows.find((r) => r.name === placeMealName)!
    const checklistRow = rows.find((r) => r.name === checklistMealName)!

    expect(placeRow.type).toBe('meal')
    expect(placeRow.meal_subtype).toBe('place')
    expect(placeRow.activity_subtype).toBeNull()
    expect(placeRow.price_amount).toBe(45)
    expect(placeRow.price_currency).toBe('USD')
    expect(placeRow.start_address).toContain('Tsukiji')
    // Duration-derived end (item 4's "twin" effect): 12:30 + 1h30 = 14:00 JST same day.
    expect(new Date(placeRow.start_at).toISOString()).toBe('2027-06-10T03:30:00.000Z')
    expect(new Date(placeRow.end_at).toISOString()).toBe('2027-06-10T05:00:00.000Z')

    expect(checklistRow.type).toBe('meal')
    expect(checklistRow.meal_subtype).toBe('checklist')
    expect(checklistRow.status).toBe('decide_later')
    expect(checklistRow.start_address).toBeNull()
    expect(checklistRow.start_lat).toBeNull()

    // --- Planning: the saved place Meal renders with the violet icon, no crash. ---
    await page.goto(`/trips/${trip.id}?tab=planning&day=2027-06-10`)
    const mealCard = page.getByRole('listitem').filter({ hasText: placeMealName })
    await expect(mealCard).toBeVisible()
    await expect(mealCard.locator('.text-violet-600 svg')).toBeVisible()
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-planning-1440.png',
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(mealCard).toBeVisible()
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-julianguerrero-Documents-Tabi/ebcfc314-3f60-499b-b4ac-8b033fa8e9bd/scratchpad/screenshots/meal-planning-390.png',
    })
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('switch ON: two overlapping meals warn; a meal overlapping an Activity does not', async ({ page, registerTrip }) => {
  await enableMealsSwitch(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal overlap ${runId}`)
  registerTrip(client, trip.id)

  try {
    const { error: activityError } = await client.from('reservations').insert(
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        name: `E2E overlap activity ${runId}`,
        start_at: '2027-06-11T10:00:00.000Z',
        start_timezone: 'UTC',
        end_at: '2027-06-11T12:00:00.000Z',
        end_timezone: 'UTC',
      }),
    )
    if (activityError) throw activityError

    // Stay menu's plain "Add reservation" button, not Activities' own "Add activity"
    // (which opens the rich place-search modal first — a different flow, unrelated here).
    await page.goto(`/trips/${trip.id}/stay`)

    // Meal #1: deliberately overlaps the Activity above (10:30-11:30 inside 10:00-12:00) —
    // same-type-only overlap (TABI-108) means this must NOT warn.
    await openAddFormAsMeal(page)
    const meal1Name = `E2E overlap meal1 ${runId}`
    await page.getByLabel('Name').fill(meal1Name)
    await page.getByLabel('Start date').fill('2027-06-11')
    await page.getByLabel('Start time').fill('10:30')
    await page.getByLabel('Hours').fill('1')
    const [meal1Insert] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Add reservation', exact: true }).click(),
    ])
    expect(meal1Insert.ok()).toBe(true)
    await expect(page.getByText('Overlapping dates')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    // Meal #2: overlaps Meal #1 (11:00-11:45 inside 10:30-11:30) — same type, must warn.
    await openAddFormAsMeal(page)
    const meal2Name = `E2E overlap meal2 ${runId}`
    await page.getByLabel('Name').fill(meal2Name)
    await page.getByLabel('Start date').fill('2027-06-11')
    await page.getByLabel('Start time').fill('11:00')
    await page.getByLabel('Minutes').fill('45')
    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByText('Overlapping dates')).toBeVisible()
    await expect(page.getByText(`This overlaps with "${meal1Name}". Is this intended?`)).toBeVisible()
    const [meal2Insert] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Yes, save anyway' }).click(),
    ])
    expect(meal2Insert.ok()).toBe(true)

    const { data: meals } = await client.from('reservations').select('name').eq('trip_id', trip.id).eq('type', 'meal')
    expect(meals?.map((m) => m.name).sort()).toEqual([meal1Name, meal2Name].sort())
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('switch ON: a Meal outside the trip dates shows Outside trip dates (Go back, then Extend)', async ({
  page,
  registerTrip,
}) => {
  await enableMealsSwitch(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal out-of-period ${runId}`, {
    start_date: '2027-07-01',
    end_date: '2027-07-05',
  })
  registerTrip(client, trip.id)

  try {
    await page.goto(`/trips/${trip.id}/stay`)

    // --- Go back: dialog dismissed, nothing saved, Start date refocused (hasEditableEndDateField fix). ---
    await openAddFormAsMeal(page)
    const name = `E2E out-of-period meal ${runId}`
    await page.getByLabel('Name').fill(name)
    await page.getByLabel('Start date').fill('2027-07-10')
    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByText('Outside trip dates')).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByText('Outside trip dates')).toHaveCount(0)
    await expect(page.getByLabel('Start date')).toBeFocused()
    await expect(page.getByLabel('Start date')).toHaveValue('2027-07-10')
    let { data: afterGoBack } = await client.from('reservations').select('id').eq('trip_id', trip.id)
    expect(afterGoBack).toHaveLength(0)

    // --- Extend: dialog, extend trip dates, Meal is saved. ---
    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByText('Outside trip dates')).toBeVisible()
    const [extendInsert] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Extend trip dates' }).click(),
    ])
    expect(extendInsert.ok()).toBe(true)
    await expect(page.getByText('Outside trip dates')).toHaveCount(0)

    // Not asserted as exactly '2027-07-10': the meal has no address/timezone, so its
    // start_at anchors to the browser's own local timezone (localTimeZone()), which can
    // shift the UTC-stored instant's LOCAL calendar date by one day either side
    // depending on the host's offset — the behavior under test is "the trip extended to
    // cover the meal", not a specific date arithmetic result already covered elsewhere
    // (reservation-detail-out-of-trip-period.spec.ts, reservation-overlap.spec.ts).
    const { data: tripRow } = await client.from('trips').select('end_date').eq('id', trip.id).single()
    expect(tripRow?.end_date).not.toBe('2027-07-05')
    expect(tripRow?.end_date >= '2027-07-10').toBe(true)
    const { data: afterExtend } = await client.from('reservations').select('name').eq('trip_id', trip.id)
    expect(afterExtend?.map((r) => r.name)).toEqual([name])
  } finally {
    await cleanupTrip(client, trip.id)
  }
})

test('switch ON: a Meal in a different city than the day\'s planned location shows the location-mismatch dialog', async ({
  page,
  registerTrip,
}) => {
  await enableMealsSwitch(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal location mismatch ${runId}`, {
    start_date: '2027-08-01',
    end_date: '2027-08-10',
  })
  registerTrip(client, trip.id)

  try {
    const { error: dayLocationError } = await client.from('trip_day_locations').insert({
      trip_id: trip.id,
      date: '2027-08-03',
      place_name: 'Paris',
      address: 'Paris, France',
      lat: 48.8566,
      lng: 2.3522,
      timezone: 'Europe/Paris',
      city: 'Paris',
    })
    if (dayLocationError) throw dayLocationError

    await page.goto(`/trips/${trip.id}/stay`)
    await openAddFormAsMeal(page)
    const name = `E2E mismatch meal ${runId}`
    await page.getByLabel('Name').fill(name)
    await page.getByLabel('Address').fill('Tsukiji Outer Market, Chuo City, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2027-08-03')
    await page.getByLabel('Start time').fill('12:00')

    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByText('Different city than planned')).toBeVisible()
    const [mismatchInsert] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Yes, save anyway' }).click(),
    ])
    expect(mismatchInsert.ok()).toBe(true)

    const { data: row } = await client.from('reservations').select('type, start_city').eq('trip_id', trip.id).single()
    expect(row?.type).toBe('meal')
    // Google's own geocoded city for this address (Tsukiji) — not "Paris", which is
    // the only assertion that actually matters here (proves the real, non-Paris city
    // is what triggered the mismatch, not a leftover/default value).
    expect(row?.start_city).not.toBe('Paris')
    expect(row?.start_city).toBeTruthy()
  } finally {
    await cleanupTrip(client, trip.id)
  }
})
