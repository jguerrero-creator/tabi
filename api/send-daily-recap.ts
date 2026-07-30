// Server-side only — Vercel Cron entry point (see vercel.json's `crons`
// entry). Vercel invokes this with `Authorization: Bearer <CRON_SECRET>`; no
// logged-in user is attached to the request, so this uses a service-role
// Supabase client (bypasses RLS by design — a trusted server job, not a
// user request) rather than the anon-key + forwarded-token pattern used by
// api/_lib/entitlements.ts.
//
// TABI-36 scope note: Tabi has no email-capture flow yet, so
// resolveRecapRecipient() has nobody real to send to today — see
// api/_lib/recapRecipient.ts. This endpoint is fully built and exercised via
// RECAP_TEST_RECIPIENT until that follow-up ticket lands.
import { createClient } from '@supabase/supabase-js'
import { buildRecapContent } from './_lib/recapContent.js'
import { renderRecapEmail } from './_lib/recapEmail.js'
import { resolveRecapRecipient } from './_lib/recapRecipient.js'
import type { Database } from '../src/types/database.types'

const RESEND_SEND_URL = 'https://api.resend.com/emails'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('send-daily-recap: Supabase service-role env vars are not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey)
  const today = new Date().toISOString().slice(0, 10)

  // A null end_date is a draft/undated trip, not an "active forever" one —
  // treating it as still-active fired a recap for every stale test trip ever
  // created without a date range set (TABI-36 incident: 65 trips matched
  // instead of the ~31 with a real future end_date). `.gte` already excludes
  // NULL rows on its own (SQL: NULL >= anything is neither true nor false).
  const { data: trips, error: tripsError } = await supabase.from('trips').select('*').gte('end_date', today)

  if (tripsError) {
    console.error('send-daily-recap: failed to load trips', tripsError)
    return jsonResponse({ error: 'Failed to load trips' }, 500)
  }

  let sent = 0
  let skipped = 0

  for (const trip of trips ?? []) {
    try {
      const [{ data: reservations, error: reservationsError }, { data: dayLocations, error: dayLocationsError }] =
        await Promise.all([
          supabase.from('reservations').select('*').eq('trip_id', trip.id),
          supabase.from('trip_day_locations').select('*').eq('trip_id', trip.id),
        ])

      if (reservationsError) throw reservationsError
      if (dayLocationsError) throw dayLocationsError

      const content = buildRecapContent(trip, reservations ?? [], dayLocations ?? [])
      const recipient = resolveRecapRecipient(trip.organizer_id)

      if (!recipient) {
        console.log('send-daily-recap: would send', {
          tripId: trip.id,
          dateKey: content.dateKey,
          itemCount: content.items.length,
        })
        skipped++
        continue
      }

      const email = renderRecapEmail(content)
      const fromAddress = process.env.RESEND_FROM_EMAIL
      const resendApiKey = process.env.RESEND_API_KEY
      if (!fromAddress || !resendApiKey) {
        console.error('send-daily-recap: Resend env vars are not configured')
        skipped++
        continue
      }

      // TABI-36 incident: `sent` previously counted every `resendResponse.ok`
      // as a real send, but 31 "sent" recaps had zero matching entries in
      // Resend's own logs — meaning `.ok` alone isn't proof Resend actually
      // accepted and logged the email. Logging the call and requiring
      // Resend's own success payload (`{ id: string }`) before counting a
      // send is how that gap gets caught instead of assumed away.
      console.log('send-daily-recap: calling Resend', { tripId: trip.id, to: recipient, from: fromAddress })

      const resendResponse = await fetch(RESEND_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: recipient,
          subject: email.subject,
          html: email.html,
        }),
      })

      const resendRawBody = await resendResponse.text()
      let resendParsedBody: { id?: string } | null = null
      try {
        resendParsedBody = JSON.parse(resendRawBody)
      } catch {
        resendParsedBody = null
      }

      console.log('send-daily-recap: Resend response', {
        tripId: trip.id,
        status: resendResponse.status,
        body: resendRawBody,
      })

      if (!resendResponse.ok || !resendParsedBody?.id) {
        console.error('send-daily-recap: Resend did not confirm a send', {
          tripId: trip.id,
          status: resendResponse.status,
          body: resendRawBody,
        })
        skipped++
        continue
      }

      sent++
    } catch (err) {
      console.error('send-daily-recap: failed to process trip', trip.id, err)
      skipped++
    }
  }

  return jsonResponse({ processed: trips?.length ?? 0, sent, skipped })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
