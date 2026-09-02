import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'

// Backlog: "Getting Around : collapser les trajets sans info utile + remonter en premier ceux
// ayant besoin d'attention". With many legs, ones with no useful info (no mode chosen, or a
// chosen mode that failed to compute) used to sit as full cards mixed in with legs that already
// have a valid travel time, making the section hard to scan. This asserts, with three
// chronological legs whose *original* order is resolved -> failed -> no-mode: (1) a leg whose
// persisted mode already failed collapses into a compact single line instead of a full card,
// (2) both needs-attention legs (failed mode, no mode) sort ahead of the resolved leg, in their
// original relative order (failed before no-mode), and (3) tapping the compact line re-expands
// it so the mode can still be changed.

test('failed-mode legs collapse to a compact line and needs-attention legs sort first', async ({
  page,
  registerTrip,
}) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
  await page.route('**/api/travel-time', (route) => route.abort())

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
      name: `E2E collapse and reorder trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-16',
      currency: 'USD',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    async function insertStay(name: string, city: string, lat: number, lng: number, startAt: string, endAt: string) {
      const { data, error } = await client
        .from('reservations')
        .insert({
          trip_id: trip.id,
          type: 'stay',
          stay_subtype: 'hotel',
          name,
          status: 'booked',
          start_at: startAt,
          end_at: endAt,
          start_address: `${city} Station, ${city}, Japan`,
          start_lat: lat,
          start_lng: lng,
          start_place_name: `${city} Station`,
          start_city: city,
          start_timezone: 'Asia/Tokyo',
        })
        .select()
        .single()
      if (error || !data) throw error ?? new Error(`${name} insert returned no row`)
      return data
    }

    // Chronological chain A -> B -> C -> D produces three legs, in this original order:
    // A-B (resolved), B-C (failed mode), C-D (no mode).
    const stayA = await insertStay('E2E Stay Tokyo', 'Tokyo', 35.6812, 139.7671, '2026-09-10T00:00:00.000Z', '2026-09-11T01:00:00.000Z')
    const stayB = await insertStay('E2E Stay Osaka', 'Osaka', 34.7024, 135.4959, '2026-09-11T06:00:00.000Z', '2026-09-12T01:00:00.000Z')
    const stayC = await insertStay('E2E Stay Kyoto', 'Kyoto', 35.0116, 135.7681, '2026-09-12T06:00:00.000Z', '2026-09-13T01:00:00.000Z')
    const stayD = await insertStay('E2E Stay Nara', 'Nara', 34.6851, 135.8048, '2026-09-13T06:00:00.000Z', '2026-09-14T01:00:00.000Z')

    // Leg A-B: mode already picked and already has a valid, resolved travel time.
    const { error: modeAbError } = await client.from('trip_leg_travel_modes').insert({
      trip_id: trip.id,
      from_reservation_id: stayA.id,
      to_reservation_id: stayB.id,
      mode: 'DRIVE',
      duration_seconds: 9000,
      distance_meters: 450000,
      has_direct_transfer: false,
      computed_at: new Date().toISOString(),
      dismissed_at: null,
    })
    if (modeAbError) throw modeAbError

    // Leg B-C: mode already picked and already known (from a previous session) to have failed —
    // no freshness for this session, so it should render collapsed on load, no click needed.
    const { error: modeBcError } = await client.from('trip_leg_travel_modes').insert({
      trip_id: trip.id,
      from_reservation_id: stayB.id,
      to_reservation_id: stayC.id,
      mode: 'TRANSIT',
      duration_seconds: null,
      distance_meters: null,
      has_direct_transfer: false,
      computed_at: new Date().toISOString(),
      dismissed_at: null,
    })
    if (modeBcError) throw modeBcError

    // Leg C-D: no mode picked at all — left untouched, no trip_leg_travel_modes row.

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByText('E2E Stay Osaka → E2E Stay Kyoto')).toBeVisible()

    const legItems = page.getByRole('listitem')

    const failedCompactLine = page.getByRole('button', {
      name: /E2E Stay Osaka → E2E Stay Kyoto.*no travel time available, tap to change mode/,
    })
    await expect(failedCompactLine).toBeVisible()

    // Original order was resolved (A-B) -> failed (B-C) -> no-mode (C-D). Reordered, both
    // needs-attention legs must precede the resolved one, with failed still ahead of no-mode
    // (their original relative order preserved).
    const allTexts = await legItems.allInnerTexts()
    const resolvedIndex = allTexts.findIndex((t) => t.includes('E2E Stay Tokyo') && t.includes('E2E Stay Osaka'))
    const failedIndex = allTexts.findIndex((t) => t.includes('E2E Stay Osaka') && t.includes('E2E Stay Kyoto'))
    const noModeIndex = allTexts.findIndex((t) => t.includes('E2E Stay Kyoto') && t.includes('E2E Stay Nara'))
    expect(failedIndex).toBeGreaterThanOrEqual(0)
    expect(noModeIndex).toBeGreaterThanOrEqual(0)
    expect(resolvedIndex).toBeGreaterThanOrEqual(0)
    expect(failedIndex).toBeLessThan(noModeIndex)
    expect(noModeIndex).toBeLessThan(resolvedIndex)

    // The no-mode leg still renders as a full card (needs the mode picker), not a compact line.
    const noModeRow = legItems.filter({ hasText: 'E2E Stay Kyoto → E2E Stay Nara' })
    await expect(noModeRow.getByText('Select a travel mode to see travel time')).toBeVisible()
    await expect(noModeRow.getByRole('radio', { name: 'Drive' })).toBeVisible()

    // The resolved leg renders as a full card too, with its duration visible.
    const resolvedRow = legItems.filter({ hasText: 'E2E Stay Tokyo → E2E Stay Osaka' })
    await expect(resolvedRow.getByRole('radio', { name: 'Drive' })).toHaveAttribute('aria-checked', 'true')
    await expect(resolvedRow.getByText('2h 30m · 450.0 km')).toBeVisible()

    // Tapping the compact line re-expands it into the full card, mode picker included, so the
    // user can still change the mode.
    await failedCompactLine.click()
    const expandedRow = legItems.filter({ hasText: 'E2E Stay Osaka → E2E Stay Kyoto' })
    await expect(expandedRow.getByRole('radio', { name: 'Transit' })).toHaveAttribute('aria-checked', 'true')
    await expect(expandedRow.getByRole('radio', { name: 'Drive' })).toBeVisible()
  } finally {
    const { error: deleteModesError } = await client.from('trip_leg_travel_modes').delete().eq('trip_id', trip.id)
    if (deleteModesError) throw deleteModesError
    const { error: deleteReservationsError } = await client.from('reservations').delete().eq('trip_id', trip.id)
    if (deleteReservationsError) throw deleteReservationsError
    const { error: deleteTripError } = await client.from('trips').delete().eq('id', trip.id)
    if (deleteTripError) throw deleteTripError
  }
})
