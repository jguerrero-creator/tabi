import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from './support/fixtures'
import { authenticatedClientFor } from './support/auth'
import { activitySeed } from './support/reservationSeeds'
import type { Database } from '../../src/types/database.types'

// Postgres' timestamptz wire format isn't guaranteed byte-for-byte stable across
// supabase-js/postgrest versions — round-trip through Date so assertions compare
// instants, not string formatting.
async function reservationIso(
  client: SupabaseClient<Database>,
  id: string,
  column: 'start_at' | 'end_at',
): Promise<string | null> {
  const { data } = await client.from('reservations').select(column).eq('id', id).single()
  const value = (data as Record<string, string | null> | null)?.[column] ?? null
  return value ? new Date(value).toISOString() : null
}

// Bug ticket: "Modifier la date d'une Activité sur la fiche détail n'est jamais vérifié
// contre les dates du voyage". Root cause: commit e8e48a3 (TABI-113 parity for
// ReservationDetailScreen) gated the "Outside trip dates" check on
// `reservation.type === 'stay' || reservation.type === 'transport'`, on the mistaken
// premise that only those two have an editable start/end pair — Activity's own
// start/duration edit (activityDatePatch, TABI-181/182) already existed in the same
// function a month earlier and was simply missed. This is the detail-screen counterpart
// of reservation-out-of-trip-period.spec.ts (which only covers the create flow,
// AddReservationModal) — no e2e test previously exercised this edit-time check for ANY
// type, Stay/Transport included, so this is a new file rather than an extension of an
// existing one.
//
// One trip, one sign-in, reused across every scenario below (anon sign-in is rate
// limited) — the trip's own dates get extended partway through (Activity scenario),
// and later scenarios' "before/after" assertions are written against whatever the
// trip's current range is at that point, not its original seed.
//
// Note on "a duration change that pushes the end past the trip's last day": this isn't
// constructible as a scenario distinct from moving the start date. `addDurationToTime`
// wraps modulo 24h and always keeps the same calendar-date string as the start (CLAUDE.md
// #6b: "an activity never spans multiple calendar days") — any duration that would
// otherwise cross into a new day instead makes the computed end instant earlier than or
// equal to the start instant, which trips the pre-existing "can't cross midnight" guard
// before the out-of-period check ever runs. So `end`'s local date (read back through its
// own stored timezone) is mathematically always identical to `start`'s — the out-of-period
// check still rightly feeds the duration-derived `end_at` into the candidate (so it would
// catch a divergence if one ever became possible), but under real data today an Activity's
// flagged field is always 'start', never 'end'. Covered below instead: a same-day duration
// edit while the start sits exactly on the trip's last day never triggers the dialog —
// proving that invariant holds (duration alone can't push you out).
test('detail-screen Activity, Stay, and Transport date edits all enforce "Outside trip dates" (inclusive bounds)', async ({
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
      name: `E2E detail out-of-period trip ${runId}`,
      start_date: '2026-09-10',
      end_date: '2026-09-15',
      currency: 'USD',
    })
    .select()
    .single()
  if (tripError || !trip) throw tripError ?? new Error('Trip insert returned no row')
  registerTrip(client, trip.id)

  try {
    // ======================================================================
    // PART A — Activity (place subtype): interior edit, extend, go-back, both
    // inclusive boundaries, and a same-day-only duration edit.
    // ======================================================================
    const { data: activity, error: activityError } = await client
      .from('reservations')
      .insert(
        activitySeed({
          trip_id: trip.id,
          type: 'activity',
          name: `E2E detail activity ${runId}`,
          start_at: '2026-09-12T10:00:00.000Z',
          start_timezone: 'UTC',
          end_at: '2026-09-12T11:00:00.000Z',
          end_timezone: 'UTC',
        }),
      )
      .select()
      .single()
    if (activityError || !activity) throw activityError ?? new Error('Activity insert returned no row')

    await page.goto(`/reservations/${activity.id}`)
    await expect(page.getByRole('heading', { name: `E2E detail activity ${runId}` })).toBeVisible()
    await expect(page.getByLabel('Start date')).toHaveValue('2026-09-12')

    // A1 — interior edit (clearly inside, not touching either boundary): no dialog, saves normally.
    await page.getByLabel('Start date').fill('2026-09-13')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    await expect.poll(() => reservationIso(client, activity.id, 'start_at')).toBe('2026-09-13T10:00:00.000Z')

    // A2 — the day AFTER the trip's current last day (2026-09-15): dialog, "Extend trip dates"
    // extends the trip and saves.
    await page.getByLabel('Start date').fill('2026-09-16')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Extend trip dates' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect
      .poll(async () => (await client.from('trips').select('end_date').eq('id', trip.id).single()).data?.end_date)
      .toBe('2026-09-16')
    await expect.poll(() => reservationIso(client, activity.id, 'start_at')).toBe('2026-09-16T10:00:00.000Z')

    // A3 — the day BEFORE the trip's (unchanged) first day (2026-09-10): dialog, "Go back"
    // discards the edit, saves nothing, and refocuses the Start date field with the typo'd
    // value still in place.
    await page.getByLabel('Start date').fill('2026-09-09')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect(page.getByLabel('Start date')).toBeFocused()
    await expect(page.getByLabel('Start date')).toHaveValue('2026-09-09')
    // Unchanged from A2 — "Go back" must not have saved this typo'd date.
    expect(await reservationIso(client, activity.id, 'start_at')).toBe('2026-09-16T10:00:00.000Z')

    // A4 — exactly ON the trip's first day (inclusive bound): no dialog, saves.
    await page.getByLabel('Start date').fill('2026-09-10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect.poll(() => reservationIso(client, activity.id, 'start_at')).toBe('2026-09-10T10:00:00.000Z')

    // A5 — exactly ON the trip's (extended) last day (inclusive bound): no dialog, saves.
    await page.getByLabel('Start date').fill('2026-09-16')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect.poll(() => reservationIso(client, activity.id, 'start_at')).toBe('2026-09-16T10:00:00.000Z')

    // A6 — duration-only edit while start stays on that same last day: still no dialog. An
    // Activity's end is always the same calendar day as its start (duration never crosses
    // midnight, see the file-level comment above), so growing the duration alone can never
    // push the check's `end` outside the trip on its own.
    await page.getByLabel('Hours').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect.poll(() => reservationIso(client, activity.id, 'end_at')).toBe('2026-09-16T20:00:00.000Z')

    // ======================================================================
    // PART B — Activity (checklist subtype): shares the exact same date fields as
    // "place" above, so it must get the same dialog.
    // ======================================================================
    const { data: checklistActivity, error: checklistActivityError } = await client
      .from('reservations')
      .insert(
        activitySeed({
          trip_id: trip.id,
          type: 'activity',
          activity_subtype: 'checklist',
          name: `E2E detail checklist ${runId}`,
          start_at: '2026-09-12T09:00:00.000Z',
          start_timezone: 'UTC',
          end_at: null,
        }),
      )
      .select()
      .single()
    if (checklistActivityError || !checklistActivity) {
      throw checklistActivityError ?? new Error('Checklist activity insert returned no row')
    }

    await page.goto(`/reservations/${checklistActivity.id}`)
    await expect(page.getByRole('heading', { name: `E2E detail checklist ${runId}` })).toBeVisible()
    await page.getByLabel('Start date').fill('2026-08-01') // well before the trip's current start (2026-09-10)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    expect(await reservationIso(client, checklistActivity.id, 'start_at')).toBe('2026-09-12T09:00:00.000Z') // unchanged

    // ======================================================================
    // PART C — Stay: unchanged behaviour (regression check). Trip is currently
    // (2026-09-10, 2026-09-16) after Part A's extension.
    // ======================================================================
    const { data: stay, error: stayError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'stay',
        stay_subtype: 'hotel',
        name: `E2E detail stay ${runId}`,
        start_at: '2026-09-11T15:00:00.000Z',
        start_timezone: 'UTC',
        end_at: '2026-09-12T11:00:00.000Z',
        end_timezone: 'UTC',
      })
      .select()
      .single()
    if (stayError || !stay) throw stayError ?? new Error('Stay insert returned no row')

    await page.goto(`/reservations/${stay.id}`)
    await expect(page.getByRole('heading', { name: `E2E detail stay ${runId}` })).toBeVisible()
    // Pushes checkout to 2026-09-21, well past the trip's current end (2026-09-16).
    await page.getByLabel('Nights').fill('10')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Extend trip dates' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect
      .poll(async () => (await client.from('trips').select('end_date').eq('id', trip.id).single()).data?.end_date)
      .toBe('2026-09-21')
    await expect.poll(() => reservationIso(client, stay.id, 'end_at')).toBe('2026-09-21T11:00:00.000Z')

    // ======================================================================
    // PART D — Transport: unchanged behaviour (regression check). Trip is currently
    // (2026-09-10, 2026-09-21) after Part C's extension.
    // ======================================================================
    const { data: transport, error: transportError } = await client
      .from('reservations')
      .insert({
        trip_id: trip.id,
        type: 'transport',
        transport_subtype: 'point_to_point',
        name: `E2E detail transport ${runId}`,
        start_at: '2026-09-12T08:00:00.000Z',
        start_timezone: 'UTC',
        end_at: '2026-09-12T11:00:00.000Z',
        end_timezone: 'UTC',
      })
      .select()
      .single()
    if (transportError || !transport) throw transportError ?? new Error('Transport insert returned no row')

    await page.goto(`/reservations/${transport.id}`)
    await expect(page.getByRole('heading', { name: `E2E detail transport ${runId}` })).toBeVisible()
    // Moved forward past the trip's current end (2026-09-21), not before departure — keeps the
    // pre-existing "arrival must be after departure" guard out of the way so this exercises the
    // out-of-period check's `end` branch specifically (unlike departure/checkout edits above,
    // which only ever exercise `start`).
    await page.getByLabel('Arrival date').fill('2026-09-25')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toBeVisible()
    await page.getByRole('button', { name: 'Go back' }).click()
    await expect(page.getByRole('heading', { name: 'Outside trip dates' })).toHaveCount(0)
    await expect(page.getByLabel('Arrival date')).toBeFocused()
    expect(await reservationIso(client, transport.id, 'end_at')).toBe('2026-09-12T11:00:00.000Z') // unchanged
  } finally {
    await client.from('reservations').delete().eq('trip_id', trip.id)
    await client.from('trips').delete().eq('id', trip.id)
  }
})
