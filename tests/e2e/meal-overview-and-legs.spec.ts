import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { mealSeed } from './support/reservationSeeds'

// Backlog: "Nouveau type de réservation Repas (Meal)" — Step 5 item (e): cross-cutting
// checks with a real Meal in the trip. All the underlying engines here
// (buildNeedsAttention, the Overview map's reservationPoints, buildTripLegs,
// computeFreeTimeBlocks) are already type-agnostic — confirmed by reading the code —
// this test is the live-browser proof, not a re-derivation of that reading. Throwaway
// trip only, never "Japon décembre".

async function createTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, name: string) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, start_date: '2027-12-01', end_date: '2027-12-03', currency: 'USD' })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

test('a to-book Meal with a place appears in Overview "needs attention", shows an amber map pin, and gets a Getting Around leg', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const trip = await createTrip(client, `E2E meal overview/legs ${runId}`)
  registerTrip(client, trip.id)

  try {
    const mealName = `E2E to-book meal ${runId}`
    const activityName = `E2E preceding activity ${runId}`
    const { error: seedError } = await client.from('reservations').insert([
      mealSeed({
        trip_id: trip.id,
        type: 'meal',
        meal_subtype: 'place',
        status: 'to_book',
        name: mealName,
        start_at: '2027-12-02T03:30:00.000Z', // 12:30 JST
        start_timezone: 'Asia/Tokyo',
        end_at: '2027-12-02T05:00:00.000Z', // 14:00 JST
        end_timezone: 'Asia/Tokyo',
        start_place_name: mealName,
        start_address: 'Shibuya, Tokyo, Japan',
        start_lat: 35.6595,
        start_lng: 139.7005,
      }),
      {
        trip_id: trip.id,
        type: 'activity',
        activity_subtype: 'place',
        status: 'booked',
        name: activityName,
        start_at: '2027-12-02T00:00:00.000Z', // 09:00 JST
        start_timezone: 'Asia/Tokyo',
        end_at: '2027-12-02T02:30:00.000Z', // 11:30 JST — 1h gap before the meal
        end_timezone: 'Asia/Tokyo',
        start_place_name: 'Shinjuku',
        start_address: 'Shinjuku, Tokyo, Japan',
        start_lat: 35.6938,
        start_lng: 139.7034,
      },
    ])
    if (seedError) throw seedError

    // --- Overview "needs attention": the to-book Meal shows up (as its own link in the
    // list, distinct from its later mention inside the collapsed Getting Around leg). ---
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('link', { name: new RegExp(mealName) })).toBeVisible()

    // --- Overview map: a pin at the Meal's place, amber (to_book). ---
    const mealMarker = page.locator(`[title="${mealName}"]`)
    await expect(mealMarker).toBeAttached()
    const dot = mealMarker.locator('span')
    await expect(dot).toHaveCSS('background-color', 'rgb(245, 158, 11)') // #f59e0b, to_book

    // --- Getting Around: a leg to the Meal renders (real travel-time lookup), and the
    // free-time block alongside it already shows the correct 1h gap (11:30->12:30 JST). ---
    await page.getByRole('button', { name: /Getting around/ }).click()
    const legRow = page.locator('li').filter({ hasText: activityName }).filter({ hasText: mealName })
    await expect(legRow).toBeVisible({ timeout: 15_000 })
    await expect(legRow).toContainText('1h free')
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
