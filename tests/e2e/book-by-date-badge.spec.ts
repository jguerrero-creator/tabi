import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { formatDayPillLabel } from '../../src/lib/datetime'

// New feature request, 2026-09-30 — an optional "book by" target date on any "To book"
// reservation, surfaced as a small days-remaining/overdue badge (green "+N" / red "-N")
// next to its status pill wherever that pill already appears: Overview's "Needs attention"
// list and Planning cards. No badge at all when book_by_date isn't set, and the badge
// stops showing once the reservation's own scheduled date arrives, regardless of
// book-by status (CLAUDE.md decided behavior #3) — exercised here via a reservation whose
// own date is already in the past.

test.use({ viewport: { width: 390, height: 844 } })

function isoDateDaysFromToday(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

test('book-by badge: days remaining/overdue, hidden without a date, hidden past the own date', async ({
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

    const nameOnTrack = `E2E book-by on-track ${runId}`
    const nameOverdue = `E2E book-by overdue ${runId}`
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
          name: nameOnTrack,
          start_at: `${futureDateKey}T10:00:00.000Z`,
          start_timezone: 'UTC',
          end_at: null,
          book_by_date: isoDateDaysFromToday(5),
        },
        {
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'place',
          status: 'to_book',
          name: nameOverdue,
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

    const onTrackRow = page.locator('li').filter({ hasText: nameOnTrack })
    await expect(onTrackRow.getByTestId('book-by-badge')).toHaveText('+5')

    const overdueRow = page.locator('li').filter({ hasText: nameOverdue })
    await expect(overdueRow.getByTestId('book-by-badge')).toHaveText('-3')

    const cutoffRow = page.locator('li').filter({ hasText: nameCutoff })
    await expect(cutoffRow.getByTestId('book-by-badge')).toHaveCount(0)

    const unsetRow = page.locator('li').filter({ hasText: nameUnset })
    await expect(unsetRow.getByTestId('book-by-badge')).toHaveCount(0)

    // --- Planning card, same future day ---
    await page.getByRole('button', { name: 'Planning' }).click()
    await page.getByRole('button', { name: formatDayPillLabel(futureDateKey) }).click()

    const mobileView = page.getByTestId('mobile-day-view')
    await expect(mobileView.locator('li').filter({ hasText: nameOnTrack }).getByTestId('book-by-badge')).toHaveText(
      '+5',
    )
    await expect(mobileView.locator('li').filter({ hasText: nameOverdue }).getByTestId('book-by-badge')).toHaveText(
      '-3',
    )
    await expect(mobileView.locator('li').filter({ hasText: nameUnset }).getByTestId('book-by-badge')).toHaveCount(0)

    // --- Switching status away hides the badge (Overview, back from Planning) ---
    await page.goto(`/reservations/${reservations[0].id}`)
    await expect(page.getByRole('heading', { name: nameOnTrack })).toBeVisible()
    await expect(page.getByLabel('Book by')).toHaveValue(isoDateDaysFromToday(5))

    await page.getByRole('radio', { name: 'Booked' }).click()
    await expect(page.getByLabel('Book by')).toHaveCount(0)

    await page.goto(`/trips/${trip.id}`)
    await expect(page.locator('li').filter({ hasText: nameOnTrack })).toHaveCount(0)

    // The book_by_date itself survives the status change (preserved, not discarded) —
    // flipping back to "To book" would show the same target date again.
    const { data: afterStatusChange, error: afterStatusChangeError } = await client
      .from('reservations')
      .select('book_by_date, status')
      .eq('id', reservations[0].id)
      .single()
    if (afterStatusChangeError) throw afterStatusChangeError
    expect(afterStatusChange.status).toBe('booked')
    expect(afterStatusChange.book_by_date).toBe(isoDateDaysFromToday(5))
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
