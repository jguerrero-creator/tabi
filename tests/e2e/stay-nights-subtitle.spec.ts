import { expect, test } from '@playwright/test'
import { authenticatedClientFor } from './support/auth'

// TABI-120 — "Sous-titre des lignes Hébergement = nombre de nuits (pas la
// date de fin)". Spec: Stay list rows show "X nights" instead of an
// end-date arrow. The count is derived from stored start_at/end_at, so it
// must be correct regardless of whether the reservation was entered via the
// nights field (TABI-112) or a manually picked end date.

test('Stay menu row shows a nights count instead of an end-date arrow, and hides it for a same-day stay', async ({
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
    .insert({
      organizer_id: user.id,
      name: `E2E nights subtitle trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-20',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')

  try {
    const { error: multiNightError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      name: `E2E multi-night hotel ${runId}`,
      status: 'booked',
      start_at: '2026-09-10T06:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-09-13T02:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (multiNightError) throw multiNightError

    const { error: sameDayError } = await client.from('reservations').insert({
      trip_id: trip.id,
      type: 'stay',
      stay_subtype: 'hotel',
      name: `E2E same-day hotel ${runId}`,
      status: 'booked',
      start_at: '2026-09-15T14:00:00.000Z',
      start_timezone: 'UTC',
      end_at: '2026-09-15T20:00:00.000Z',
      end_timezone: 'UTC',
    })
    if (sameDayError) throw sameDayError

    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    await expect(page.getByRole('link', { name: new RegExp(`E2E multi-night hotel ${runId}`) })).toContainText(
      '3 nights',
    )

    const sameDayRow = page.getByRole('link', { name: new RegExp(`E2E same-day hotel ${runId}`) })
    await expect(sameDayRow).toBeVisible()
    await expect(sameDayRow).not.toContainText('night')

    // Trip covers nights Sep 10-19; res1 covers 10-12, res2 (same-day) covers none,
    // so the remaining contiguous gap is Sep 13-19 = 7 nights.
    await expect(page.getByText('7 nights not booked')).toBeVisible()
  } finally {
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
