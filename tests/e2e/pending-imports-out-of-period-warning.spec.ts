import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import type { ExtractedReservation } from '../../src/types/extractedReservation'
import type { Database } from '../../src/types/database.types'

type PendingImportRow = Database['public']['Tables']['pending_reservation_imports']['Row']

// Backlog: "Bannière From your inbox : avertir qu'une réservation reçue par email est
// datée hors des dates du voyage" — the "From your inbox" banner (PendingImportsSection)
// now warns before the user even opens Review when the extracted date falls outside the
// trip's current [start_date, end_date] — both bounds inclusive, same boundary rule as
// outOfPeriodField/TABI-113 (a date exactly on the trip's first/last day is a normal
// changeover, not "outside" — this is the same asymmetry a past bug got wrong on 08-27).
//
// pending_reservation_imports rows can only ever be created by the webhook's
// service-role client (RLS forbids a normal user inserting them — see
// usePendingReservationImports.ts's own comment), and this suite deliberately never
// uses the service-role key against the real project (see support/auth.ts). So this
// stubs the hook's own GET instead of seeding real rows — same technique already used
// elsewhere in this suite (e.g. add-reservation-trip-fetch-race.spec.ts) for a request
// this suite can't or shouldn't originate for real.
//
// Seeds one real trip (26 Dec - 9 Jan) and a fixture list of six pending imports
// covering: inside the range, before start, after end, exactly on the start date,
// exactly on the end date, and no extracted date at all — then checks the banner
// renders (or omits) the warning line for each. No reservation is ever actually saved.
test('the "From your inbox" banner warns when an extracted date falls outside the trip, both bounds inclusive', async ({
  page,
  registerTrip,
}) => {
  await page.route('https://maps.googleapis.com/**', (route) => route.abort())
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
      name: `E2E pending-imports out-of-period trip ${runId}`,
      start_date: '2026-12-26',
      end_date: '2027-01-09',
      currency: 'EUR',
      day_start_time: '08:00',
      day_end_time: '22:00',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  function extracted(startDateTime: string | null): ExtractedReservation {
    return {
      type: 'activity',
      staySubtype: null,
      transportSubtype: null,
      transportMode: null,
      name: 'E2E test activity',
      startAddress: null,
      endAddress: null,
      startDateTime,
      endDateTime: null,
      confirmationNumber: null,
      price: null,
    }
  }

  const rows: { subject: string; startDateTime: string | null }[] = [
    { subject: 'Inside trip', startDateTime: '2026-12-30T11:00' },
    { subject: 'Before trip start', startDateTime: '2026-10-28T11:00' },
    { subject: 'After trip end', startDateTime: '2027-01-15T09:00' },
    { subject: 'On trip start date', startDateTime: '2026-12-26T08:00' },
    { subject: 'On trip end date', startDateTime: '2027-01-09T22:00' },
    { subject: 'No extracted date', startDateTime: null },
  ]

  const fixtureRows: PendingImportRow[] = rows.map((row, i) => ({
    id: `e2e-${runId}-${i}`,
    trip_id: trip.id,
    created_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    reviewed_at: null,
    outcome: null,
    sender_email: 'booking@getyourguide.com',
    subject: row.subject,
    extracted: extracted(row.startDateTime) as unknown as PendingImportRow['extracted'],
  }))

  try {
    await page.route('**/rest/v1/pending_reservation_imports*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureRows) })
    })

    await page.goto(`/trips/${trip.id}`)
    await expect(page.getByRole('heading', { name: 'From your inbox' })).toBeVisible()

    async function warningTextFor(subject: string): Promise<string | null> {
      const row = page.locator('li').filter({ hasText: subject })
      await expect(row).toBeVisible()
      const warning = row.locator('p.text-amber-700')
      if ((await warning.count()) === 0) return null
      return warning.innerText()
    }

    const report: Record<string, string | null> = {}
    for (const row of rows) {
      report[row.subject] = await warningTextFor(row.subject)
    }

    console.log('Rendered warning text per row:', JSON.stringify(report, null, 2))

    expect(report['Inside trip']).toBeNull()
    expect(report['Before trip start']).toBe('Dated Oct 28, outside this trip (Dec 26 – Jan 9)')
    expect(report['After trip end']).toBe('Dated Jan 15, outside this trip (Dec 26 – Jan 9)')
    expect(report['On trip start date']).toBeNull() // inclusive bound
    expect(report['On trip end date']).toBeNull() // inclusive bound
    expect(report['No extracted date']).toBeNull()
  } finally {
    await client.from('trips').delete().eq('id', trip.id)
  }
})
