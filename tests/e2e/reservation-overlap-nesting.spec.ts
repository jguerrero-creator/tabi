import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

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

test('a confirmed overlapping transport reservation renders nested under the longer one', async ({ page }) => {
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
