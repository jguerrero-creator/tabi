import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { activitySeed } from './support/reservationSeeds'

// TABI-110 — a same-type overlap confirmed at save time (TABI-108/109) renders
// nested/indented under the longer reservation in date-grouped lists, with a
// discreet badge, rather than as its own separate date section (Decision Log:
// "Chevauchements de dates: confirmation explicite à la saisie, affichage
// imbriqué dans les listes").

function dateHeader(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(
    new Date(isoUtc),
  )
}

test('a confirmed overlapping stay renders nested under the longer stay, not as its own date section', async ({
  page,
  registerTrip,
}) => {
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
    .insert({ organizer_id: user.id, name: `E2E nesting trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const mainName = `E2E nesting main stay ${runId}`
    const nestedName = `E2E nesting overlap stay ${runId}`

    // 15-night stay with a single night booked elsewhere in the middle
    // (Decision Log's own example case).
    const mainStart = '2026-10-01T06:00:00.000Z'
    const mainEnd = '2026-10-16T02:00:00.000Z'
    const nestedStart = '2026-10-08T15:00:00.000Z'
    const nestedEnd = '2026-10-09T02:00:00.000Z'

    const { error: seedError } = await client.from('reservations').insert([
      {
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        status: 'booked',
        name: mainName,
        start_at: mainStart,
        start_timezone: 'Asia/Tokyo',
        end_at: mainEnd,
        end_timezone: 'Asia/Tokyo',
      },
      {
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        status: 'booked',
        name: nestedName,
        start_at: nestedStart,
        start_timezone: 'Asia/Tokyo',
        end_at: nestedEnd,
        end_timezone: 'Asia/Tokyo',
      },
    ])
    if (seedError) throw seedError

    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    await expect(page.getByText(mainName)).toBeVisible()
    await expect(page.getByText(nestedName)).toBeVisible()
    await expect(page.getByText('↳ Also booked during this period')).toBeVisible()

    // Only the main stay's date section exists — the nested item doesn't get its own.
    await expect(page.getByRole('heading', { name: dateHeader(mainStart, 'Asia/Tokyo') })).toBeVisible()
    await expect(page.getByRole('heading', { name: dateHeader(nestedStart, 'Asia/Tokyo') })).toHaveCount(0)

    const rows = page.locator('main li')
    await expect(rows.filter({ hasText: mainName })).toHaveCount(1)
    await expect(rows.filter({ hasText: nestedName })).toHaveCount(1)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('a confirmed overlapping transport reservation renders nested under the longer one', async ({ page, registerTrip }) => {
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
    .insert({ organizer_id: user.id, name: `E2E nesting transport trip ${runId}`, start_date: null, end_date: null, currency: 'USD' })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const mainName = `E2E nesting main rental ${runId}`
    const nestedName = `E2E nesting overlap ferry ${runId}`

    // 10-day car rental with a boat trip in between (Decision Log's second example case).
    const mainStart = '2026-11-01T00:00:00.000Z'
    const mainEnd = '2026-11-11T00:00:00.000Z'
    const nestedStart = '2026-11-05T09:00:00.000Z'
    const nestedEnd = '2026-11-05T14:00:00.000Z'

    const { error: seedError } = await client.from('reservations').insert([
      {
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        status: 'booked',
        name: mainName,
        start_at: mainStart,
        start_timezone: 'Asia/Tokyo',
        end_at: mainEnd,
        end_timezone: 'Asia/Tokyo',
      },
      {
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        status: 'booked',
        name: nestedName,
        start_at: nestedStart,
        start_timezone: 'Asia/Tokyo',
        end_at: nestedEnd,
        end_timezone: 'Asia/Tokyo',
      },
    ])
    if (seedError) throw seedError

    await page.goto(`/trips/${trip.id}/transport`)
    await expect(page.getByRole('heading', { name: 'Transport' })).toBeVisible()

    await expect(page.getByText(mainName)).toBeVisible()
    await expect(page.getByText(nestedName)).toBeVisible()
    await expect(page.getByText('↳ Also booked during this period')).toBeVisible()

    await expect(page.getByRole('heading', { name: dateHeader(mainStart, 'Asia/Tokyo') })).toBeVisible()
    await expect(page.getByRole('heading', { name: dateHeader(nestedStart, 'Asia/Tokyo') })).toHaveCount(0)

    const rows = page.locator('main li')
    await expect(rows.filter({ hasText: mainName })).toHaveCount(1)
    await expect(rows.filter({ hasText: nestedName })).toHaveCount(1)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

// Bugs DB: "Faux temps libre quand une réservation est imbriquée dans une plage
// plus longue" — a Meal/Activity nested inside a longer Activity (e.g. lunch
// inside a full-day "Visit Nikko") made the Planning rail show free time
// starting from the NESTED item's own end instead of the enclosing one's real
// end. `computeFreeTimeBlocks`/`computeDayEdgeFreeBlocks` now merge occupied
// intervals before computing gaps (`buildOccupiedClusters`) — this is the
// Planning-rail regression test for that fix.
test("a reservation nested inside a longer one shows the real free time starting from the enclosing reservation's end", async ({
  page,
  registerTrip,
}) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.setViewportSize({ width: 390, height: 844 })
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
      name: `E2E false-free-time trip ${runId}`,
      start_date: '2026-11-20',
      end_date: '2026-11-20',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const nikkoName = `E2E Visit Nikko ${runId}`
    const lunchName = `E2E lunch ${runId}`
    const nextName = `E2E next stop ${runId}`

    // 10:00-18:00 JST, 12:30-14:00 JST (nested inside it), 19:00-20:00 JST.
    const { error: seedError } = await client.from('reservations').insert([
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name: nikkoName,
        start_at: '2026-11-20T01:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: '2026-11-20T09:00:00.000Z',
        end_timezone: 'Asia/Tokyo',
      }),
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name: lunchName,
        start_at: '2026-11-20T03:30:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: '2026-11-20T05:00:00.000Z',
        end_timezone: 'Asia/Tokyo',
      }),
      activitySeed({
        trip_id: trip.id,
        type: 'activity',
        status: 'booked',
        name: nextName,
        start_at: '2026-11-20T10:00:00.000Z',
        start_timezone: 'Asia/Tokyo',
        end_at: '2026-11-20T11:00:00.000Z',
        end_timezone: 'Asia/Tokyo',
      }),
    ])
    if (seedError) throw seedError

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('button', { name: 'Planning' })).toBeVisible()
    await page.getByRole('button', { name: 'Planning' }).click()

    const mobileView = page.getByTestId('mobile-day-view')
    const nikkoRow = mobileView.locator('li').filter({ hasText: nikkoName })
    const lunchRow = mobileView.locator('li').filter({ hasText: lunchName })
    const nextRow = mobileView.locator('li').filter({ hasText: nextName })

    await expect(nikkoRow).toBeVisible()
    await expect(lunchRow).toBeVisible()
    await expect(nextRow).toBeVisible()

    // Chronological order: Nikko (10:00) -> Lunch (12:30) -> free (18:00-19:00,
    // 1h) -> Next (19:00). No free/travel row between Nikko and Lunch, and the
    // free block must render after Lunch, not before it.
    const afterNikko = nikkoRow.locator('xpath=following-sibling::li[1]')
    await expect(afterNikko).toContainText(lunchName)

    const afterLunch = lunchRow.locator('xpath=following-sibling::li[1]')
    await expect(afterLunch).toContainText('free')
    await expect(afterLunch).toContainText('1h')
    await expect(afterLunch).not.toContainText('5h')

    const afterFree = afterLunch.locator('xpath=following-sibling::li[1]')
    await expect(afterFree).toContainText(nextName)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
