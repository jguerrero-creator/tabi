import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Backlog TABI-263 "Budget par personne" — Step A. Named travelers live inside the
// trip's own settings (TripFormModal), never a nav tab (souvenirs-budget-merge-navigation.spec.ts
// locks the bottom nav to exactly 5 entries). The one real regression risk this step
// can introduce: an existing trip's stored traveler_count (used today to divide Stay
// costs) must never be silently changed by typing names — only a name added BEYOND
// the current count may raise it, and removing a name must never lower it.

async function createTrip(
  client: Awaited<ReturnType<typeof authenticatedClientFor>>,
  name: string,
  travelerCount: number,
) {
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('Anonymous sign-in did not produce a user')
  const { data: trip, error } = await client
    .from('trips')
    .insert({ organizer_id: user.id, name, currency: 'USD', traveler_count: travelerCount })
    .select()
    .single()
  if (error || !trip) throw error ?? new Error('Trip insert returned no row')
  return trip
}

async function cleanupTrip(client: Awaited<ReturnType<typeof authenticatedClientFor>>, tripId: string) {
  // trip_travelers has ON DELETE CASCADE from trips, so deleting the trip is enough.
  await client.from('trips').delete().eq('id', tripId)
}

test('named travelers: add/rename/delete respect the traveler-count trap; absent from trip creation', async ({
  page,
  registerTrip,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
  const client = await authenticatedClientFor(page)
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tripName = `E2E travelers ${runId}`
  // Mirrors the real "Japon décembre" trip's shape: traveler_count = 2, no names yet.
  const trip = await createTrip(client, tripName, 2)
  registerTrip(client, trip.id)

  try {
    // --- The Travelers section only exists once a trip exists to attach rows to. ---
    await page.locator('header').getByRole('button', { name: 'New trip' }).click()
    await expect(page.getByRole('heading', { name: 'New Trip' })).toBeVisible()
    await expect(page.getByText('Travelers', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    // --- Open the edit modal for our seeded trip specifically (never Japon décembre). ---
    await page.reload()
    await expect(page.getByRole('heading', { name: 'My Trips' })).toBeVisible()
    const row = page.getByRole('listitem').filter({ hasText: tripName })
    await row.getByRole('button', { name: 'Edit trip' }).click()
    await expect(page.getByRole('heading', { name: 'Edit Trip' })).toBeVisible()
    await expect(page.getByText('Travelers', { exact: true })).toBeVisible()
    // Scoped to the travelers list itself — the trip list underneath the modal
    // overlay still has its own <li> elements in the DOM, so an unscoped
    // getByRole('listitem') would be ambiguous.
    const travelersList = page.getByRole('list', { name: 'Named travelers' })

    async function addTraveler(name: string) {
      await page.getByRole('button', { name: 'Add traveler' }).click()
      await page.getByPlaceholder('Traveler name').fill(name)
      await Promise.all([
        page.waitForResponse((res) => res.url().includes('/rest/v1/trip_travelers') && res.request().method() === 'POST'),
        page.getByRole('button', { name: 'Save', exact: true }).click(),
      ])
    }

    // THE TRAP: a 2-traveler trip gets exactly one name — the lodging split must
    // stay divided by 2, so the stored count must NOT drop to 1.
    await addTraveler('Alice')
    await expect(travelersList.getByText('Alice', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Number of travelers')).toHaveValue('2')

    // Rename — persists without affecting the count. Exactly one traveler row
    // exists at this point, so no further scoping is needed.
    await travelersList.getByRole('button', { name: 'Edit traveler name' }).click()
    await travelersList.getByRole('textbox').fill('Alicia')
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/trip_travelers') && res.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ])

    // A second name brings the named total to 2 — still not beyond the stored
    // count, so no bump yet.
    await addTraveler('Bob')
    await expect(page.getByLabel('Number of travelers')).toHaveValue('2')

    // A third name finally exceeds the stored count — this is the one case that
    // SHOULD raise it, immediately (not deferred to the form's Save button).
    await addTraveler('Carol')
    await expect(page.getByLabel('Number of travelers')).toHaveValue('3')

    // Deleting a name must never lower the count back down.
    const carolRow = travelersList.getByRole('listitem').filter({ hasText: 'Carol' })
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/trip_travelers') && res.request().method() === 'DELETE'),
      carolRow.getByRole('button', { name: 'Delete traveler' }).click(),
    ])
    await expect(travelersList.getByText('Carol', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Number of travelers')).toHaveValue('3')

    // Case-insensitive, trimmed duplicate is rejected with a friendly message, not
    // a raw Postgres error, and leaves the list unchanged.
    await page.getByRole('button', { name: 'Add traveler' }).click()
    await page.getByPlaceholder('Traveler name').fill('  ALICIA  ')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('A traveler with this name already exists.')).toBeVisible()

    // --- DB, read-only: final state matches exactly what the UI showed. ---
    const { data: travelers } = await client.from('trip_travelers').select('name').eq('trip_id', trip.id)
    expect(travelers?.map((t) => t.name).sort()).toEqual(['Alicia', 'Bob'].sort())
    const { data: tripRow } = await client.from('trips').select('traveler_count').eq('id', trip.id).single()
    expect(tripRow?.traveler_count).toBe(3)
  } finally {
    await cleanupTrip(client, trip.id)
  }
})
