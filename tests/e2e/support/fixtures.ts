import { test as base, expect } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/types/database.types'

type RegisterTrip = (client: SupabaseClient<Database>, tripId: string) => void

/**
 * TABI-202 safety net: every spec's inline `try { ... } finally { delete }`
 * already cleans up its own trip, but that's just a promise racing the
 * test's own completion — if a test times out and Playwright recycles the
 * worker, the in-flight finally block can be abandoned mid-delete (this is
 * how 70+ orphaned "E2E " trips built up in prod and were later matched as
 * active by the TABI-36 reminder cron, triggering real emails). Fixture
 * teardown runs as part of Playwright's own test lifecycle regardless of
 * pass/fail/timeout, so registering a trip here re-deletes it (a harmless
 * no-op if the spec's own finally already succeeded).
 */
export const test = base.extend<{ registerTrip: RegisterTrip }>({
  registerTrip: async ({}, use) => {
    const created: { client: SupabaseClient<Database>; tripId: string }[] = []
    await use((client, tripId) => {
      created.push({ client, tripId })
    })
    for (const { client, tripId } of created) {
      await client.from('reservations').delete().eq('trip_id', tripId)
      await client.from('trips').delete().eq('id', tripId)
    }
  },
})

export { expect }
