import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { formatDayPillLabel } from '../../src/lib/datetime'

// "Book by" target date feature, 2026-09-30 — an optional target date on any "To book"
// reservation, surfaced as a small days-remaining/overdue badge next to its status pill
// wherever that pill already appears: Overview's "Needs attention" list and Planning
// cards. Copy/threshold decided 2026-10-09:
// - green pill "N days" ("1 day" singular), hover tooltip "N days left to book"
// - red pill "N days late" ("1 day late" singular), hover tooltip "N days overdue to book"
// - the deadline day itself (0 days remaining) is RED, not green — "0 days late" / "0 days
//   overdue to book"
// No badge at all when book_by_date isn't set, the badge stops showing once the
// reservation's own scheduled date arrives regardless of book-by status (CLAUDE.md
// decided behavior #3), and no badge once status moves away from "To book".

test.use({ viewport: { width: 390, height: 844 } })

function isoDateDaysFromToday(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

test('book-by badge: new day-count copy, red-at-zero threshold, hover tooltip', async ({ page, registerTrip }) => {
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
      name: `E2E book-by trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const futureDateKey = isoDateDaysFromToday(30)
    const pastDateKey = isoDateDaysFromToday(-1)

    const name78Days = `E2E book-by 78d ${runId}`
    const name1Day = `E2E book-by 1d ${runId}`
    const nameToday = `E2E book-by today ${runId}`
    const name3DaysLate = `E2E book-by 3d-late ${runId}`
    const nameCutoff = `E2E book-by cutoff ${runId}`
    const nameUnset = `E2E book-by unset ${runId}`

    const { data: reservations, error: insertError } = await client
      .from('reservations')
      .insert([
        {
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'to_book',
          name: name78Days,
          start_at: `${futureDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: null,
          book_by_date: isoDateDaysFromToday(78),
        },
        {
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'to_book',
          name: name1Day,
          start_at: `${futureDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: null,
          book_by_date: isoDateDaysFromToday(1),
        },
        {
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'to_book',
          name: nameToday,
          start_at: `${futureDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: null,
          book_by_date: isoDateDaysFromToday(0),
        },
        {
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'to_book',
          name: name3DaysLate,
          start_at: `${futureDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: null,
          book_by_date: isoDateDaysFromToday(-3),
        },
        // Own scheduled date already passed — the badge must not show even though its
        // book-by date is also overdue (the cutoff wins regardless of book-by status).
        {
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'to_book',
          name: nameCutoff,
          start_at: `${pastDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: null,
          book_by_date: isoDateDaysFromToday(-3),
        },
        {
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'to_book',
          name: nameUnset,
          start_at: `${futureDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: null,
          book_by_date: null,
        },
      ])
      .select()
    if (insertError || !reservations) throw insertError ?? new Error('Reservation insert returned no rows')

    // --- Overview's "Needs attention" list (already filtered to status === 'to_book') ---
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible()

    const badge78Days = page.locator('li').filter({ hasText: name78Days }).getByTestId('book-by-badge')
    await expect(badge78Days).toHaveText('78 days')
    await expect(badge78Days).toHaveAttribute('title', '78 days left to book')
    await expect(badge78Days).toHaveAttribute('aria-label', '78 days left to book')

    const badge1Day = page.locator('li').filter({ hasText: name1Day }).getByTestId('book-by-badge')
    await expect(badge1Day).toHaveText('1 day')
    await expect(badge1Day).toHaveAttribute('title', '1 day left to book')
    await expect(badge1Day).toHaveAttribute('aria-label', '1 day left to book')

    // Rule change 2026-10-09: the deadline day itself is now red, not green.
    const badgeToday = page.locator('li').filter({ hasText: nameToday }).getByTestId('book-by-badge')
    await expect(badgeToday).toHaveText('0 days late')
    await expect(badgeToday).toHaveAttribute('title', '0 days overdue to book')
    await expect(badgeToday).toHaveAttribute('aria-label', '0 days overdue to book')

    const badge3DaysLate = page.locator('li').filter({ hasText: name3DaysLate }).getByTestId('book-by-badge')
    await expect(badge3DaysLate).toHaveText('3 days late')
    await expect(badge3DaysLate).toHaveAttribute('title', '3 days overdue to book')
    await expect(badge3DaysLate).toHaveAttribute('aria-label', '3 days overdue to book')

    const cutoffRow = page.locator('li').filter({ hasText: nameCutoff })
    await expect(cutoffRow.getByTestId('book-by-badge')).toHaveCount(0)

    const unsetRow = page.locator('li').filter({ hasText: nameUnset })
    await expect(unsetRow.getByTestId('book-by-badge')).toHaveCount(0)

    // --- Planning card, same future day ---
    await page.getByRole('button', { name: 'Planning' }).click()
    await page.getByRole('button', { name: formatDayPillLabel(futureDateKey) }).click()

    const mobileView = page.getByTestId('mobile-day-view')
    await expect(
      mobileView.locator('li').filter({ hasText: name78Days }).getByTestId('book-by-badge'),
    ).toHaveText('78 days')
    await expect(
      mobileView.locator('li').filter({ hasText: nameToday }).getByTestId('book-by-badge'),
    ).toHaveText('0 days late')
    await expect(mobileView.locator('li').filter({ hasText: nameUnset }).getByTestId('book-by-badge')).toHaveCount(0)

    // --- Switching status away hides the badge (Overview, back from Planning) ---
    await page.goto(`/reservations/${reservations[0].id}`)
    await expect(page.getByRole('heading', { name: name78Days })).toBeVisible()
    await expect(page.getByLabel('Book by')).toHaveValue(isoDateDaysFromToday(78))

    await page.getByRole('radio', { name: 'Booked' }).click()
    await expect(page.getByLabel('Book by')).toHaveCount(0)

    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('li').filter({ hasText: name78Days })).toHaveCount(0)

    // The book_by_date itself survives the status change (preserved, not discarded) —
    // flipping back to "To book" would show the same target date again.
    const { data: afterStatusChange, error: afterStatusChangeError } = await client
      .from('reservations')
      .select('book_by_date, status')
      .eq('id', reservations[0].id)
      .single()
    if (afterStatusChangeError) throw afterStatusChangeError
    expect(afterStatusChange.status).toBe('booked')
    expect(afterStatusChange.book_by_date).toBe(isoDateDaysFromToday(78))
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})

test('book-by badge: Transport and Stay reservations show the badge and the editable field on their detail screens', async ({
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
    .insert({
      organizer_id: user.id,
      name: `E2E book-by types trip ${runId}`,
      start_date: null,
      end_date: null,
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    const futureDateKey = isoDateDaysFromToday(30)
    const bookByKey = isoDateDaysFromToday(10)

    const nameTransport = `E2E book-by transport ${runId}`
    const nameStay = `E2E book-by stay ${runId}`

    const { data: reservations, error: insertError } = await client
      .from('reservations')
      .insert([
        {
          trip_id: trip.id,
          type: 'transport',
          transport_subtype: 'point_to_point',
          status: 'to_book',
          name: nameTransport,
          start_at: `${futureDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: `${futureDateKey}T14:00:00.000Z`,
          end_timezone: 'UTC',
          book_by_date: bookByKey,
        },
        {
          trip_id: trip.id,
          type: 'stay',
          stay_subtype: 'hotel',
          status: 'to_book',
          name: nameStay,
          start_at: `${futureDateKey}T14:00:00.000Z`,
          end_at: isoDateDaysFromToday(32) + 'T11:00:00.000Z',
          book_by_date: bookByKey,
        },
      ])
      .select()
    if (insertError || !reservations) throw insertError ?? new Error('Reservation insert returned no rows')
    const transportId = reservations.find((r) => r.type === 'transport')!.id
    const stayId = reservations.find((r) => r.type === 'stay')!.id

    // --- Overview's "Needs attention" list shows the same badge for these types too ---
    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible()

    const transportBadge = page.locator('li').filter({ hasText: nameTransport }).getByTestId('book-by-badge')
    await expect(transportBadge).toHaveText('10 days')
    await expect(transportBadge).toHaveAttribute('title', '10 days left to book')

    const stayBadge = page.locator('li').filter({ hasText: nameStay }).getByTestId('book-by-badge')
    await expect(stayBadge).toHaveText('10 days')
    await expect(stayBadge).toHaveAttribute('title', '10 days left to book')

    // --- Each reservation's own detail screen: the "Book by" field renders for both
    // non-Activity types, not just Activity (the earlier version of this spec only
    // ever seeded an Activity/place reservation).
    await page.goto(`/reservations/${transportId}`)
    await expect(page.getByRole('heading', { name: nameTransport })).toBeVisible()
    await expect(page.getByLabel('Book by')).toHaveValue(bookByKey)

    await page.goto(`/reservations/${stayId}`)
    await expect(page.getByRole('heading', { name: nameStay })).toBeVisible()
    await expect(page.getByLabel('Book by')).toHaveValue(bookByKey)
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
