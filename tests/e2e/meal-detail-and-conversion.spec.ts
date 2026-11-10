import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { activitySeed, mealSeed } from './support/reservationSeeds'

// Backlog: "Nouveau type de réservation Repas (Meal)" — Step 4c. The shared detail
// screen can now edit a Meal's date/time/duration and convert it between its two
// subtypes (place <-> checklist), mirroring Activity exactly (mealDatePatch, and
// handleSubtypeChange/convertToChecklist/convertToPlace writing meal_subtype). The
// detail screen route (/reservations/:id) isn't gated by the Meal feature switch —
// only the Add form's type option, the nav tab, and the route are (Step 3) — so these
// tests seed a Meal directly via mealSeed() and navigate straight to its detail URL,
// same as reservation-detail-out-of-trip-period.spec.ts does for Activity/Stay/Transport.
//
// This file also closes a separate, pre-existing Backlog gap ("Aucun test e2e pour la
// conversion d'une Activité lieu vers checklist (et retour)") with its own test below,
// since it exercises the exact same conversion code path this file is already testing.

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

    // A duration-only edit while start sits exactly on the trip's LAST day never pushes a
    // Meal outside the trip — same invariant reservation-detail-out-of-trip-period.spec.ts
    // proves for Activity (addDurationToTime wraps modulo 24h; CLAUDE.md #6b: a Meal, like
    // an Activity, never spans multiple calendar days), now re-verified for Meal specifically
    // rather than assumed from the shared code path alone.
    await page.getByLabel('Start date').fill('2027-09-15')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await page.getByLabel('Hours').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect
      .poll(async () => (await client.from('reservations').select('end_at').eq('id', meal.id).single()).data?.end_at)
      .toBe('2027-09-15T20:00:00+00:00')
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

test('detail screen converts a place Meal to checklist and back: notes and checklist items survive, status is forced then editable again', async ({
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
    const noteText = `Keep this note through conversion ${runId}`
    const { data: meal, error: mealError } = await client
      .from('reservations')
      .insert(
        mealSeed({
          trip_id: trip.id,
          type: 'meal',
          meal_subtype: 'place',
          status: 'booked',
          name: `E2E convertible meal ${runId}`,
          note: noteText,
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
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(noteText)

    // --- Planning card renders for the place subtype, no crash. ---
    await page.goto(`/trips/${trip.id}?tab=planning&day=2027-10-02`)
    await expect(page.getByRole('listitem').filter({ hasText: meal.name }).locator('.text-violet-600 svg')).toBeVisible()
    await page.goto(`/reservations/${meal.id}`)

    // place -> checklist: the existing place is preserved as the checklist's first item,
    // status is forced to decide_later, place-specific columns are cleared, and the note
    // (a generic field, untouched by either conversion branch) survives unchanged.
    await page.getByRole('radio', { name: 'Checklist (a few options to pick from)' }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    await expect
      .poll(async () => (await client.from('reservations').select('meal_subtype').eq('id', meal.id).single()).data?.meal_subtype)
      .toBe('checklist')
    const afterToChecklist = await client
      .from('reservations')
      .select('status, start_address, start_lat, note')
      .eq('id', meal.id)
      .single()
    expect(afterToChecklist.data?.status).toBe('decide_later')
    expect(afterToChecklist.data?.start_address).toBeNull()
    expect(afterToChecklist.data?.start_lat).toBeNull()
    expect(afterToChecklist.data?.note).toBe(noteText)
    const { data: checklistItems } = await client
      .from('checklist_items')
      .select('id, name, address')
      .eq('reservation_id', meal.id)
    expect(checklistItems).toHaveLength(1)
    expect(checklistItems?.[0]?.name).toBe(placeName)
    expect(checklistItems?.[0]?.address).toBe('123 Test St')
    const preservedItemId = checklistItems![0]!.id

    // No Status picker for a checklist Meal (forced + hidden, same as checklist Activity);
    // the note field is still there, unaffected by the subtype switch.
    await expect(page.getByText('Status', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(noteText)

    // --- Checklist item CRUD for a Meal: rename the preserved item, add a second one
    // manually (skip the Places search to avoid a live Google call), remove the first. ---
    const renamedName = `${placeName} (renamed)`
    await page.getByRole('button', { name: `Rename: ${placeName}` }).click()
    // The rename input is `autoFocus`-ed the moment it replaces the button — the only
    // focused input on the page right after the click, more robust than a value-based CSS
    // selector (React sets the `value` property, not the HTML attribute, so `input[value=…]`
    // wouldn't match a live-typed value, nor would `hasText` on the parent <li> once its
    // content has swapped from a text button to an input, which has no text content).
    const renameInput = page.locator('input:focus')
    await renameInput.fill(renamedName)
    await renameInput.press('Enter')
    await expect
      .poll(async () => (await client.from('checklist_items').select('name').eq('id', preservedItemId).single()).data?.name)
      .toBe(renamedName)

    await page.getByRole('button', { name: '+ Add place' }).click()
    await page.getByRole('button', { name: 'Enter manually instead' }).click()
    const secondItemName = `E2E manual item ${runId}`
    // Scoped to the "Add item" sheet specifically — both its Name field and Save button
    // would otherwise be ambiguous with the main reservation form's own Name/Save.
    const addItemSheet = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Add item' }) })
    await addItemSheet.getByLabel('Name').fill(secondItemName)
    await addItemSheet.getByRole('button', { name: 'Save' }).click()
    await expect
      .poll(async () => (await client.from('checklist_items').select('id').eq('reservation_id', meal.id)).data?.length)
      .toBe(2)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: `Remove ${renamedName}` }).click()
    await expect
      .poll(async () => (await client.from('checklist_items').select('id').eq('reservation_id', meal.id)).data?.length)
      .toBe(1)
    const { data: remainingItems } = await client.from('checklist_items').select('id, name').eq('reservation_id', meal.id)
    expect(remainingItems?.[0]?.name).toBe(secondItemName)

    // --- Planning card renders for the checklist subtype too, no crash. ---
    await page.goto(`/trips/${trip.id}?tab=planning&day=2027-10-02`)
    await expect(page.getByRole('listitem').filter({ hasText: meal.name }).locator('.text-violet-600 svg')).toBeVisible()
    await page.goto(`/reservations/${meal.id}`)
    // The remount needs its own useChecklistItems fetch to resolve before the subtype
    // radio is clicked below, or handleSubtypeChange sees a still-empty items array and
    // silently skips the "choose which item to keep" dialog entirely.
    await expect(page.getByText(secondItemName)).toBeVisible()

    // checklist -> place: choosing the one remaining item promotes it back onto the
    // reservation, the checklist is cleared, the note is still unchanged, and the Status
    // picker is visible and genuinely editable again (not just re-rendered at its forced value).
    await page.getByRole('radio', { name: 'Specific place' }).click()
    await expect(page.getByRole('heading', { name: 'Switch to a specific place' })).toBeVisible()
    // Proves the dialog's body text is parametrized by type — "Meal", not "Activity".
    await expect(page.getByText(/fits on a single-place Meal/)).toBeVisible()
    await page.getByRole('radio', { name: secondItemName }).click()
    await page.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('heading', { name: 'Switch to a specific place' })).toHaveCount(0)

    await expect
      .poll(async () => (await client.from('reservations').select('meal_subtype').eq('id', meal.id).single()).data?.meal_subtype)
      .toBe('place')
    const afterToPlace = await client
      .from('reservations')
      .select('start_address, start_place_name, status, note')
      .eq('id', meal.id)
      .single()
    expect(afterToPlace.data?.start_place_name).toBe(secondItemName)
    expect(afterToPlace.data?.note).toBe(noteText)
    expect(afterToPlace.data?.status).toBe('decide_later') // inherited, not auto-reset — the picker is editable, not pre-changed
    const { data: itemsAfter } = await client.from('checklist_items').select('id').eq('reservation_id', meal.id)
    expect(itemsAfter).toHaveLength(0)

    // The Status picker is visible again and genuinely editable: changing it actually saves.
    await expect(page.getByText('Status', { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'On location' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('radio', { name: 'To book' }).click()
    await expect
      .poll(async () => (await client.from('reservations').select('status').eq('id', meal.id).single()).data?.status)
      .toBe('to_book')
  } finally {
    await client.from('checklist_items').delete().eq('trip_id', trip.id)
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})

// Backlog: "Aucun test e2e pour la conversion d'une Activité lieu vers checklist (et
// retour) : en écrire un" — closed here, in the same file as the Meal conversion test
// above, since both exercise the identical shared code path (handleSubtypeChange /
// convertToChecklist / convertToPlace, generalized in Step 4c).
test('detail screen converts a place Activity to checklist and back: notes survive, status is forced then editable again', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E activity conversion ${runId}`, { start_date: '2027-11-01', end_date: '2027-11-05' })
  registerTrip(client, trip.id)

  try {
    const placeName = `E2E activity place ${runId}`
    const noteText = `Keep this note through conversion ${runId}`
    const { data: activity, error: activityError } = await client
      .from('reservations')
      .insert(
        activitySeed({
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'booked',
          name: `E2E convertible activity ${runId}`,
          note: noteText,
          start_at: '2027-11-02T12:00:00.000Z',
          start_timezone: 'UTC',
          end_at: '2027-11-02T13:00:00.000Z',
          end_timezone: 'UTC',
          start_place_name: placeName,
          start_address: '456 Test Ave',
          start_lat: 36.0,
          start_lng: 140.0,
        }),
      )
      .select()
      .single()
    if (activityError || !activity) throw activityError ?? new Error('Activity insert returned no row')

    await page.goto(`/reservations/${activity.id}`)
    await expect(page.getByRole('heading', { name: `E2E convertible activity ${runId}` })).toBeVisible()
    await expect(page.getByText('Activity type')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Specific place' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(noteText)

    await page.getByRole('radio', { name: 'Checklist (a few options to pick from)' }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    await expect
      .poll(
        async () => (await client.from('reservations').select('activity_subtype').eq('id', activity.id).single()).data?.activity_subtype,
      )
      .toBe('checklist')
    const afterToChecklist = await client
      .from('reservations')
      .select('status, start_address, note')
      .eq('id', activity.id)
      .single()
    expect(afterToChecklist.data?.status).toBe('decide_later')
    expect(afterToChecklist.data?.start_address).toBeNull()
    expect(afterToChecklist.data?.note).toBe(noteText)
    await expect(page.getByText('Status', { exact: true })).toHaveCount(0)
    const { data: checklistItems } = await client.from('checklist_items').select('name').eq('reservation_id', activity.id)
    expect(checklistItems?.[0]?.name).toBe(placeName)

    await page.getByRole('radio', { name: 'Specific place' }).click()
    await expect(page.getByRole('heading', { name: 'Switch to a specific place' })).toBeVisible()
    // Proves the dialog's body text still reads "Activity" (not generically blank or wrong)
    // now that it's parametrized by type rather than hardcoded.
    await expect(page.getByText(/fits on a single-place Activity/)).toBeVisible()
    await page.getByRole('radio', { name: placeName }).click()
    await page.getByRole('button', { name: 'Switch' }).click()
    await expect(page.getByRole('heading', { name: 'Switch to a specific place' })).toHaveCount(0)

    await expect
      .poll(
        async () => (await client.from('reservations').select('activity_subtype').eq('id', activity.id).single()).data?.activity_subtype,
      )
      .toBe('place')
    const afterToPlace = await client.from('reservations').select('status, note').eq('id', activity.id).single()
    expect(afterToPlace.data?.note).toBe(noteText)
    expect(afterToPlace.data?.status).toBe('decide_later')

    await expect(page.getByText('Status', { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Booked' }).click()
    await expect
      .poll(async () => (await client.from('reservations').select('status').eq('id', activity.id).single()).data?.status)
      .toBe('booked')
  } finally {
    await client.from('checklist_items').delete().eq('trip_id', trip.id)
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
