import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { mealSeed } from './support/reservationSeeds'

// Backlog: "Nouveau type de réservation Repas (Meal)" — Step 5 (nav tab, route, Meal
// menu). A throwaway trip only — never "Japon décembre" (the real trip).

async function createTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, name: string) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

test('the Meals tab, route, and menu work — place and checklist meals, filter pills, add preselects Meal', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal nav/menu ${runId}`)
  registerTrip(client, trip.id)

  try {
    const placeMealName = `E2E nav place meal ${runId}`
    const checklistMealName = `E2E nav checklist meal ${runId}`
    const { error: seedError } = await client.from('reservations').insert([
      mealSeed({
        trip_id: trip.id,
        type: 'meal',
        meal_subtype: 'place',
        status: 'booked',
        name: placeMealName,
        start_at: '2027-06-10T03:30:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: '2027-06-10T05:00:00.000Z',
        end_timezone: 'Asia/Tokyo',
      }),
      mealSeed({
        trip_id: trip.id,
        type: 'meal',
        meal_subtype: 'checklist',
        status: 'decide_later',
        name: checklistMealName,
        start_at: null,
        end_at: null,
      }),
    ])
    if (seedError) throw seedError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('link', { name: 'Meals' })).toBeVisible()
    await page.getByRole('link', { name: 'Meals' }).click()
    await expect(page).toHaveURL(`/trips/${trip.id}/meals`)
    await expect(page.getByRole('heading', { name: 'Meals' })).toBeVisible()

    // Both subtypes render in the list, grouped by date (checklist meal with no date
    // lands in "Unscheduled", same as a checklist Activity).
    await expect(page.getByText(placeMealName)).toBeVisible()
    await expect(page.getByText(checklistMealName)).toBeVisible()
    await expect(page.getByText('Unscheduled')).toBeVisible()

    // --- Filter pills: place / checklist. ---
    await page.getByRole('button', { name: 'Specific place' }).click()
    await expect(page.getByText(placeMealName)).toBeVisible()
    await expect(page.getByText(checklistMealName)).toHaveCount(0)
    await page.getByRole('button', { name: 'Specific place' }).click() // deselect
    await page.getByRole('button', { name: 'Checklist (a few options to pick from)' }).click()
    await expect(page.getByText(checklistMealName)).toBeVisible()
    await expect(page.getByText(placeMealName)).toHaveCount(0)
    await page.getByRole('button', { name: 'Checklist (a few options to pick from)' }).click() // clear filter

    // --- Adding from the Meals menu preselects type "Meal" (collapsed type summary,
    // same "don't re-ask within an origin menu" pattern every other per-type menu uses). ---
    await page.getByRole('button', { name: 'Add reservation (Meal)' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByText('Meal', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change type' })).toBeVisible()
  } finally {
    await client.from('checklist_items').delete().eq('trip_id', trip.id)
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
