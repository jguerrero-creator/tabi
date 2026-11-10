import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { mealSeed } from './support/reservationSeeds'

// Backlog: "Nouveau type de réservation Repas (Meal)" — Step 4c. The shared detail
// screen can now edit a Meal's date/time/duration and convert it between its two
// subtypes (place <-> checklist), mirroring Activity exactly (mealDatePatch, and
// handleSubtypeChange/convertToChecklist/convertToPlace writing meal_subtype). The
// detail screen route (/reservations/:id) isn't gated by the Meal feature switch —
// only the Add form's type option, the nav tab, and the route are (Step 3) — so these
// tests seed a Meal directly via mealSeed() and navigate straight to its detail URL,
// same as reservation-detail-out-of-trip-period.spec.ts does for Activity/Stay/Transport.

async function createTrip(
  client: Awaited<ReturnType<typeof authenticatedClientFor>>,
  name: string,
  dates: { start_date: string; end_date: string },
) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, start_date: dates.start_date, end_date: dates.end_date, currency: 'USD' })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

test('detail screen edits a Meal\'s date/time/duration (mealDatePatch) and enforces Outside trip dates', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal detail edit ${runId}`, { start_date: '2027-09-10', end_date: '2027-09-15' })
  registerTrip(client, trip.id)

  try {
    const { data: meal, error: mealError } = await client
      .from('reservations')
      .insert(
        mealSeed({
          trip_id: trip.id,
          type: 'meal',
          meal_subtype: 'place',
          name: `E2E meal to edit ${runId}`,
          start_at: '2027-09-12T10:00:00.000Z',
          start_timezone: 'UTC',
          end_at: '2027-09-12T11:00:00.000Z',
          end_timezone: 'UTC',
        }),
      )
      .select()
      .single()
    if (mealError || !meal) throw mealError ?? new Error('Meal insert returned no row')

    await page.goto(`/reservations/${meal.id}`)
    await expect(page.getByRole('heading', { name: `E2E meal to edit ${runId}` })).toBeVisible()
    // Proves the date/time/duration fields render for a Meal at all (isPlaceOrChecklistType
    // gate), pre-filled from the real row (not blank, which the old `=== 'activity'` gate
    // would have produced).
    await expect(page.getByLabel('Start date')).toHaveValue('2027-09-12')
    await expect(page.getByLabel('Start time')).toHaveValue('10:00')
    await expect(page.getByLabel('Hours')).toHaveValue('1')

    // Interior edit: no out-of-period dialog, saves normally.
    await page.getByLabel('Start date').fill('2027-09-13')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect
      .poll(async () => (await client.from('reservations').select('start_at').eq('id', meal.id).single()).data?.start_at)
      .toBe('2027-09-13T10:00:00+00:00')

    // Duration edit alone also persists (proves mealDatePatch, not just the start date, is real).
    await page.getByLabel('Hours').fill('3')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect
      .poll(async () => (await client.from('reservations').select('end_at').eq('id', meal.id).single()).data?.end_at)
      .toBe('2027-09-13T13:00:00+00:00')

    // Outside the trip's range: the out-of-period dialog must fire for a Meal too (the
    // datePatchByType / outOfPeriodFocusTargetIdByType entries are no longer placeholders).
    await page.getByLabel('Start date').fill('2027-09-20')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect(page.getByLabel('Start date')).toBeFocused()
    // Unsaved — still the pre-edit value from the DB's point of view.
    expect((await client.from('reservations').select('start_at').eq('id', meal.id).single()).data?.start_at).toBe(
      '2027-09-13T10:00:00+00:00',
    )
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

test('detail screen converts a place Meal to checklist (preserving the place) and back to a chosen item', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal conversion ${runId}`, { start_date: '2027-10-01', end_date: '2027-10-05' })
  registerTrip(client, trip.id)

  try {
    const placeName = `E2E meal place ${runId}`
    const { data: meal, error: mealError } = await client
      .from('reservations')
      .insert(
        mealSeed({
          trip_id: trip.id,
          type: 'meal',
          meal_subtype: 'place',
          status: 'booked',
          name: `E2E convertible meal ${runId}`,
          start_at: '2027-10-02T12:00:00.000Z',
          start_timezone: 'UTC',
          end_at: '2027-10-02T13:00:00.000Z',
          end_timezone: 'UTC',
          start_place_name: placeName,
          start_address: '123 Test St',
          start_lat: 35.0,
          start_lng: 139.0,
        }),
      )
      .select()
      .single()
    if (mealError || !meal) throw mealError ?? new Error('Meal insert returned no row')

    await page.goto(`/reservations/${meal.id}`)
    await expect(page.getByRole('heading', { name: `E2E convertible meal ${runId}` })).toBeVisible()
    // "Meal type" label, not "Activity type" — proves the Meal-specific label branch.
    await expect(page.getByText('Meal type')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Specific place' })).toHaveAttribute('aria-checked', 'true')

    // place -> checklist: the existing place is preserved as the checklist's first item,
    // status is forced to decide_later, and place-specific columns are cleared.
    await page.getByRole('radio', { name: 'Checklist (a few options to pick from)' }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    await expect
      .poll(async () => (await client.from('reservations').select('meal_subtype').eq('id', meal.id).single()).data?.meal_subtype)
      .toBe('checklist')
    const afterToChecklist = await client.from('reservations').select('status, start_address, start_lat').eq('id', meal.id).single()
    expect(afterToChecklist.data?.status).toBe('decide_later')
    expect(afterToChecklist.data?.start_address).toBeNull()
    expect(afterToChecklist.data?.start_lat).toBeNull()
    const { data: checklistItems } = await client.from('checklist_items').select('name, address').eq('reservation_id', meal.id)
    expect(checklistItems).toHaveLength(1)
    expect(checklistItems?.[0]?.name).toBe(placeName)
    expect(checklistItems?.[0]?.address).toBe('123 Test St')

    // No Status picker and no Address field for a checklist Meal (same as checklist Activity).
    await expect(page.getByText('Status', { exact: true })).toHaveCount(0)

    // checklist -> place: choosing the preserved item promotes it back onto the reservation,
    // and the checklist is cleared.
    await page.getByRole('radio', { name: 'Specific place' }).click()
    await expect(page.getByRole('heading', { name: 'Switch to a specific place' })).toBeVisible()
    // Proves the dialog's body text is parametrized by type — "Meal", not "Activity".
    await expect(page.getByText(/fits on a single-place Meal/)).toBeVisible()
    await page.getByRole('radio', { name: placeName }).click()
    await page.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('heading', { name: 'Switch to a specific place' })).toHaveCount(0)

    await expect
      .poll(async () => (await client.from('reservations').select('meal_subtype').eq('id', meal.id).single()).data?.meal_subtype)
      .toBe('place')
    const afterToPlace = await client
      .from('reservations')
      .select('start_address, start_place_name')
      .eq('id', meal.id)
      .single()
    expect(afterToPlace.data?.start_place_name).toBe(placeName)
    expect(afterToPlace.data?.start_address).toBe('123 Test St')
    const { data: itemsAfter } = await client.from('checklist_items').select('id').eq('reservation_id', meal.id)
    expect(itemsAfter).toHaveLength(0)
  } finally {
    await client.from('checklist_items').delete().eq('trip_id', trip.id)
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
