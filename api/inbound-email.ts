// Server-side only — TABI: Resend `email.received` webhook for the per-trip
// forward-a-booking-confirmation import channel ("Adresse email dédiée par voyage" in
// the Backlog). A forwarded email lands here with no active app session, unlike every
// other import channel, so it can't reuse requireEntitlement()/checkRateLimit() as-is —
// those resolve the caller from an Authorization header, and there is no caller here,
// only a trip resolved from which dedicated address the mail was sent to. Uses a
// service-role Supabase client throughout instead (bypasses RLS by design — a trusted
// server job, not a user request — same pattern as ./send-daily-recap.ts).
//
// Feeds the SAME extraction pipeline as every other channel (./_lib/extraction.ts) —
// never a parallel path — and never auto-creates a reservation: a successful
// extraction is only ever stored as a pending_reservation_imports row, surfaced as a
// banner on Overview, and turned into a real reservation through the normal
// AddReservationModal save, exactly like every other channel's confirmation screen.
//
// Imported email content is untrusted data (TABI-93), same as any other channel — the
// forced-tool-call extraction pipeline already treats it that way; nothing here adds
// any additional trust to a forwarded email over a pasted/uploaded one.
import { createClient } from '@supabase/supabase-js'
import { requireEntitlementForOrganizer } from './_lib/entitlements.js'
import type { ContentBlockParam, ExtractedReservation, ExtractResult } from './_lib/extraction.js'
import { runExtractionStreaming } from './_lib/extraction.js'
import { checkTripRateLimit } from './_lib/tripRateLimit.js'
import { verifySvixSignature } from './_lib/svixVerify.js'
import type { Database } from '../src/types/database.types'

export const config = { runtime: 'edge' }

const RESEND_API_BASE = 'https://api.resend.com'
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// Same ceilings as ImportConfirmationModal's client-side upload limits — a booking
// confirmation attachment has no legitimate reason to approach either.
const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024

// A real photo of a ticket/receipt, even compressed, is essentially always well above
// this — a genuinely tiny image attachment is a template logo/icon, not booking
// content. Second layer of defense behind the content_disposition filter in
// selectFallbackAttachment below, for a sender/client that omits that header. Not
// applied to PDFs, since a real single-page e-ticket PDF can legitimately be a few KB.
const MIN_IMAGE_ATTACHMENT_SIZE_BYTES = 15 * 1024

interface ResendWebhookEvent {
  type: string
  data: {
    email_id: string
    from: string
    to: string[]
    cc?: string[] | null
    bcc?: string[] | null
    subject?: string | null
  }
}

export interface ResendReceivedEmail {
  html: string | null
  text: string | null
  attachments: Array<{
    id: string
    filename: string
    content_type: string
    content_disposition: string | null
    size: number
  }>
}

type ResendAttachment = ResendReceivedEmail['attachments'][number]

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET
  const resendApiKey = process.env.RESEND_API_KEY
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!webhookSecret || !resendApiKey || !anthropicApiKey || !supabaseUrl || !serviceRoleKey) {
    console.error('inbound-email: required env vars are not configured')
    return new Response('Server misconfigured', { status: 500 })
  }

  // Signature verification needs the exact raw bytes Resend signed — must read as
  // text before any JSON parsing, never re-serialize and verify that instead.
  const rawBody = await request.text()
  const verified = await verifySvixSignature({
    secret: webhookSecret,
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
    body: rawBody,
  })
  if (!verified) {
    console.error('inbound-email: signature verification failed')
    return new Response('Invalid signature', { status: 401 })
  }

  let event: ResendWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  if (event.type !== 'email.received') {
    // Ack anything else so Resend doesn't retry a webhook event this endpoint was
    // never meant to handle in the first place.
    return new Response('Ignored', { status: 200 })
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey)

  const recipientLocalParts = [...(event.data.to ?? []), ...(event.data.cc ?? []), ...(event.data.bcc ?? [])]
    .map(extractLocalPart)
    .filter((part): part is string => Boolean(part))

  if (recipientLocalParts.length === 0) {
    console.log('inbound-email: no recipient addresses on event', event.data.email_id)
    return new Response('No matching trip', { status: 200 })
  }

  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id, organizer_id')
    .in('inbound_email_local_part', recipientLocalParts)
    .maybeSingle()

  if (tripError) {
    console.error('inbound-email: failed to resolve trip', tripError)
    return new Response('Server error', { status: 500 })
  }
  if (!trip) {
    // Nobody's address matched — most likely spam probing the address pattern once
    // it's known, or a stale/mistyped forward. Not retryable, nothing to notify.
    console.log('inbound-email: no trip matched recipient', event.data.email_id)
    return new Response('No matching trip', { status: 200 })
  }

  const rateLimit = await checkTripRateLimit(supabase, trip.id, 'inbound-email')
  if (!rateLimit.allowed) {
    console.warn('inbound-email: rate limit exceeded for trip', trip.id, rateLimit.reason)
    return new Response('Rate limited', { status: 200 })
  }

  const entitlement = await requireEntitlementForOrganizer(supabase, trip.organizer_id, { feature: 'aiAccess' })
  if (!entitlement.allowed) {
    console.warn('inbound-email: entitlement denied for trip', trip.id, entitlement.reason)
    return new Response('Not entitled', { status: 200 })
  }

  const emailResponse = await fetch(`${RESEND_API_BASE}/emails/receiving/${event.data.email_id}`, {
    headers: { Authorization: `Bearer ${resendApiKey}` },
  })
  if (!emailResponse.ok) {
    console.error('inbound-email: failed to fetch received email', emailResponse.status, await emailResponse.text())
    return new Response('Failed to fetch email', { status: 500 })
  }
  const email: ResendReceivedEmail = await emailResponse.json()

  // Body-first (see the "Import par email" bug — a GetYourGuide activity confirmation's
  // real booking facts were sitting in the text body, but a genuinely-attached, non-inline
  // Terms & Conditions PDF was picked instead, because the old buildContentBlock() treated
  // *any* non-inline PDF/image as reason enough to skip the body entirely, with no check
  // that the attachment itself held anything useful). The body is virtually always the
  // richest source for a forwarded confirmation; an attachment is only reached for when
  // there's no body at all, or (below, after extraction) the body turned out empty.
  const bodyBlock = buildBodyContentBlock(email)
  const primaryBlock = bodyBlock ?? (await buildAttachmentFallbackBlock(email, resendApiKey, event.data.email_id))
  if (!primaryBlock) {
    console.log('inbound-email: no usable content, skipping extraction', event.data.email_id)
    return new Response('No usable content', { status: 200 })
  }

  // TABI-8's fix, reused: Vercel Edge's 25s cap is on time-to-first-byte, not total
  // duration. The original blocking runExtraction() call here (like import-url.ts)
  // hit exactly this on 2026-09-22 — a real forwarded email 504'd on its first
  // delivery attempt (Claude's stream took 23s to open) and was only saved by
  // Resend's own webhook retry. Opening the stream and committing to a Response
  // immediately, before it's fully consumed, is what actually satisfies the cap —
  // see api/extract-reservation.ts and api/_lib/extraction.ts's comments for the
  // full mechanism. The trade-off (same one extract-reservation.ts already accepts):
  // once the stream has opened, Resend gets its 200 regardless of what happens during
  // accumulation, so a genuine mid-stream failure no longer gets a retry — only a
  // stream-open failure (returned synchronously below) still does.
  const opened = await runExtractionStreaming(
    primaryBlock,
    'Extract this reservation from the forwarded email above.',
    anthropicApiKey,
    'inbound-email',
  )

  if (opened.status === 'error') {
    console.error('inbound-email: failed to open extraction stream', trip.id, opened.error)
    // Non-2xx so Resend retries — this is a fast failure (bad request, auth, network
    // error before the stream ever opened), same distinction extract-reservation.ts
    // makes, so retrying costs nothing and might catch a transient issue.
    return new Response('Extraction failed', { status: 500 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      let result: ExtractResult
      try {
        result = await opened.consume()
      } catch (error) {
        console.error('inbound-email: streamed extraction failed unexpectedly', trip.id, error)
        controller.enqueue(encoder.encode('Extraction failed'))
        controller.close()
        return
      }

      if (result.status === 'error') {
        console.error('inbound-email: extraction failed', trip.id, result.error)
        controller.enqueue(encoder.encode('Extraction failed'))
        controller.close()
        return
      }

      // One fallback retry against a supported attachment — only when the body is what we
      // actually sent as the primary attempt (if there was no body at all, the attachment
      // fallback above already *was* the primary attempt, so there's nothing left to retry
      // with) and only when the body came back with nothing usable. Runs here, inside the
      // already-committed background stream, specifically so a second sequential Claude call
      // never risks the TTFB cap Resend's response is judged against.
      if (bodyBlock && isEmptyExtraction(result.result)) {
        console.log('inbound-email: body extraction came back empty, retrying once against an attachment', trip.id)
        const fallbackBlock = await buildAttachmentFallbackBlock(email, resendApiKey, event.data.email_id)
        if (fallbackBlock) {
          const fallbackOpened = await runExtractionStreaming(
            fallbackBlock,
            'Extract this reservation from the forwarded email above.',
            anthropicApiKey,
            'inbound-email-fallback',
          )
          if (fallbackOpened.status === 'error') {
            console.error('inbound-email: failed to open fallback extraction stream', trip.id, fallbackOpened.error)
          } else {
            try {
              const fallbackResult = await fallbackOpened.consume()
              if (fallbackResult.status === 'ok') {
                result = fallbackResult
              } else {
                console.error('inbound-email: fallback attachment extraction failed', trip.id, fallbackResult.error)
              }
            } catch (error) {
              console.error('inbound-email: fallback attachment extraction failed unexpectedly', trip.id, error)
            }
          }
        }
      }

      // An all-null (or name/date-less) result — including after the fallback above — is a
      // failure to surface, never a normal import to confirm: opening AddReservationModal
      // with nothing pre-filled is indistinguishable from this channel being silently broken.
      // Stored with outcome: 'failed' rather than skipped outright, so Overview can still tell
      // the organizer an email came in and let them dismiss it, and so there's a record to
      // investigate rather than a silently dropped webhook event.
      const empty = isEmptyExtraction(result.result)
      if (empty) {
        console.log('inbound-email: extraction produced nothing usable, storing as a failed import', trip.id)
      }

      const { error: insertError } = await supabase.from('pending_reservation_imports').insert({
        trip_id: trip.id,
        sender_email: event.data.from,
        subject: event.data.subject ?? null,
        extracted: result.result,
        outcome: empty ? 'failed' : null,
      })

      if (insertError) {
        console.error('inbound-email: failed to store pending import', trip.id, insertError)
      }

      controller.enqueue(encoder.encode(empty ? 'Extraction empty' : 'OK'))
      controller.close()
    },
  })

  return new Response(stream, { status: 200 })
}

function extractLocalPart(address: string): string | null {
  const at = address.indexOf('@')
  if (at <= 0) return null
  return address.slice(0, at).trim().toLowerCase()
}

// The body is virtually always the richest source for a forwarded confirmation — no
// minimum-length gate here (that used to decide whether the body was "worth" an
// extraction call at all; now the decision is made on the *result*, see
// isEmptyExtraction below, never on how short the input looked going in). Only a
// genuinely empty body (no text, no HTML to fall back to) returns null.
export function buildBodyContentBlock(email: ResendReceivedEmail): ContentBlockParam | null {
  const text = (email.text ?? stripHtml(email.html ?? '')).trim()
  if (!text) return null
  return { type: 'text', text }
}

// 2026-09-21/22 fix, unchanged: a real forwarded Booking.com confirmation carried 13
// attachments, all tiny (< 8KB) PNG/GIF template logos/icons — Outlook/Hotmail
// re-serializes an HTML email's inline `cid:`-referenced images as numbered attachment
// parts (ATT00001.png, ...) when forwarding. `content_disposition === 'inline'` is the
// real, direct signal for this (a genuinely user-attached ticket/photo is never marked
// inline); the size floor below is a second layer for a sender/client that omits that
// header rather than the primary defense. This only selects which attachment is worth
// falling back to — it no longer decides whether the body gets looked at first.
export function selectFallbackAttachment(attachments: ResendAttachment[] | undefined): ResendAttachment | null {
  return (
    attachments?.find((attachment) => {
      if (attachment.content_disposition === 'inline') return false
      if (attachment.content_type === 'application/pdf') return true
      if (ALLOWED_IMAGE_TYPES.includes(attachment.content_type)) {
        return attachment.size >= MIN_IMAGE_ATTACHMENT_SIZE_BYTES
      }
      return false
    }) ?? null
  )
}

async function fetchAttachmentContentBlock(
  attachment: ResendAttachment,
  resendApiKey: string,
  emailId: string,
): Promise<ContentBlockParam | null> {
  if (attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
    console.log('inbound-email: attachment too large, skipping', emailId, attachment.size)
    return null
  }

  const attachmentResponse = await fetch(
    `${RESEND_API_BASE}/emails/receiving/${emailId}/attachments/${attachment.id}`,
    { headers: { Authorization: `Bearer ${resendApiKey}` } },
  )
  if (!attachmentResponse.ok) {
    console.error('inbound-email: failed to fetch attachment metadata', await attachmentResponse.text())
    return null
  }
  const { download_url: downloadUrl } = (await attachmentResponse.json()) as { download_url?: string }
  if (!downloadUrl) return null

  const fileResponse = await fetch(downloadUrl)
  if (!fileResponse.ok) {
    console.error('inbound-email: failed to download attachment content', fileResponse.status)
    return null
  }
  const base64 = bytesToBase64(new Uint8Array(await fileResponse.arrayBuffer()))

  return attachment.content_type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: attachment.content_type, data: base64 } }
}

export async function buildAttachmentFallbackBlock(
  email: ResendReceivedEmail,
  resendApiKey: string,
  emailId: string,
): Promise<ContentBlockParam | null> {
  const attachment = selectFallbackAttachment(email.attachments)
  if (!attachment) return null
  return fetchAttachmentContentBlock(attachment, resendApiKey, emailId)
}

// A result with nothing a confirmation screen could usefully show — every field null, or
// (a looser but still useless case) some weak type/subtype guess with neither a name nor a
// date to anchor it. Used both to decide whether the attachment fallback is worth trying and,
// after it, whether to store the import as outcome: 'failed' instead of a normal pending one.
export function isEmptyExtraction(result: ExtractedReservation): boolean {
  const allNull =
    result.type === null &&
    result.name === null &&
    result.startAddress === null &&
    result.endAddress === null &&
    result.startDateTime === null &&
    result.endDateTime === null &&
    result.confirmationNumber === null &&
    result.price === null
  if (allNull) return true
  return !result.name && !result.startDateTime
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
