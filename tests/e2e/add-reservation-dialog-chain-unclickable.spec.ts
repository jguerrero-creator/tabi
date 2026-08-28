import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Bug ticket "L'UI devient totalement non cliquable juste après l'une des modales..."
// (Bugs DB, Sévérité: Bloquant). Root cause: handleExtendTrip set `submitting` true for
// the trip-dates PATCH, but only reset it on the error path — on success it handed off to
// proceedAfterOutOfPeriodCheck, which can open a SECOND ConfirmDialog (location mismatch)
// instead of calling submitReservation (the only place that reliably reset the flag, via
// its own `finally`). Every ConfirmDialog's buttons are `disabled={confirming}` and
// FormSheet's own Cancel/Submit are `disabled={submitting}` — so the leftover `true` left
// the second dialog, and the whole form behind it, with no clickable element anywhere; only
// a refresh (which loses the draft) recovered. This is specific to the extend → second-dialog
// chain, not to any dialog standing alone — confirmed by the standalone case below, which
// was never affected because its confirm/cancel handlers never touch `submitting` directly.

test('extend-trip-dates chaining into a second dialog leaves it fully interactive, not stuck', async ({
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
      name: `E2E dialog chain trip ${runId}`,
      start_date: '2027-05-10',
      end_date: '2027-05-15',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // 2027-05-09 (the night we're about to extend the trip to cover) and 2027-05-12 (already
    // inside the trip) are both planned as "Paris" — anywhere the Stay's own Tokyo address
    // resolves to will mismatch either one.
    const { error: dayLocationError } = await client.from('trip_day_locations').insert([
      { trip_id: trip.id, date: '2027-05-09', place_name: 'Paris', address: 'Paris, France', lat: 48.8566, lng: 2.3522, timezone: 'Europe/Paris', city: 'Paris' },
      { trip_id: trip.id, date: '2027-05-12', place_name: 'Paris', address: 'Paris, France', lat: 48.8566, lng: 2.3522, timezone: 'Europe/Paris', city: 'Paris' },
    ])
    if (dayLocationError) throw dayLocationError

    await page.goto(`/trips/${trip.id}/stay`)
    await expect(page.getByRole('heading', { name: 'Stay' })).toBeVisible()

    // --- Chain: "Outside trip dates" -> Extend -> "Different city than planned" must open
    // fully interactive, not stuck behind a leftover `submitting: true` ---
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const chainName = `E2E dialog chain ${runId}`
    await page.getByLabel('Name').fill(chainName)
    await page.getByLabel('Address').fill('Tokyo Tower, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2027-05-09')
    await page.getByLabel('Nights').fill('1')

    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Extend trip dates' }).click()

    await expect(page.getByRole('heading', { name: 'Different city than planned' })).toBeVisible()
    // The bug's exact symptom: this dialog's own buttons rendered permanently disabled.
    const saveAnywayButton = page.getByRole('button', { name: 'Yes, save anyway' })
    await expect(saveAnywayButton).toBeEnabled()

    const [chainSaveResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/rest/v1/reservations') && res.request().method() === 'POST'),
      saveAnywayButton.click(),
    ])
    expect(chainSaveResponse.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Different city than planned' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
    await expect(page.getByText(chainName)).toBeVisible()

    // UI is genuinely interactive afterward, not just "this one button happened to work".
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)

    // --- Standalone: a "Different city than planned" dialog with no preceding extend was
    // never affected (its own handlers never touch `submitting`) — confirm it stays fine ---
    await page.getByRole('button', { name: 'Add reservation' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const standaloneName = `E2E dialog standalone ${runId}`
    await page.getByLabel('Name').fill(standaloneName)
    await page.getByLabel('Address').fill('Tokyo Tower, Tokyo, Japan')
    await page.getByLabel('Start date').fill('2027-05-12')
    await page.getByLabel('Nights').fill('1')

    await page.getByRole('button', { name: 'Add reservation', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Different city than planned' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go back' })).toBeEnabled()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Different city than planned' })).toHaveCount(0)

    // Dialog dismissed without saving — the form underneath is still open and genuinely
    // interactive (not just visible-but-inert): the Cancel button actually responds.
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible()
    await expect(page.getByLabel('Name')).toHaveValue(standaloneName)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toHaveCount(0)
  } finally {
    const { error: deleteDayLocationsError } = await client.from('trip_day_locations').delete().eq('trip_id', trip.id)
    if (deleteDayLocationsError) throw deleteDayLocationsError
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
