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
import type { ContentBlockParam } from './_lib/extraction.js'
import { runExtraction } from './_lib/extraction.js'
import { checkTripRateLimit } from './_lib/tripRateLimit.js'
import { verifySvixSignature } from './_lib/svixVerify.js'
import type { Database } from '../src/types/database.types'

export const config = { runtime: 'edge' }

const RESEND_API_BASE = 'https://api.resend.com'
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// Same ceilings as ImportConfirmationModal's client-side upload limits — a booking
// confirmation attachment has no legitimate reason to approach either.
const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024

// Cheap pre-filter before ever calling Claude: only applies when there's no supported
// attachment (an attachment is already a strong positive signal worth extracting on its
// own). A near-empty body — an auto-reply, a bounce notice, a bare forward with the
// real content only in an attachment we don't support — isn't worth the extraction
// call. Deliberately conservative (length only, no keyword matching) since a false
// negative here means a real booking is silently never reviewed; a wasted Claude call
// on a genuinely too-short email is the safer failure mode.
const MIN_TEXT_BODY_LENGTH = 30

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

interface ResendReceivedEmail {
  html: string | null
  text: string | null
  attachments: Array<{ id: string; filename: string; content_type: string; size: number }>
}

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

  const contentBlock = await buildContentBlock(email, resendApiKey, event.data.email_id)
  if (!contentBlock) {
    console.log('inbound-email: no usable content, skipping extraction', event.data.email_id)
    return new Response('No usable content', { status: 200 })
  }

  const result = await runExtraction(
    contentBlock,
    'Extract this reservation from the forwarded email above.',
    anthropicApiKey,
    'inbound-email',
  )

  if (result.status === 'error') {
    console.error('inbound-email: extraction failed', trip.id, result.error)
    // Non-2xx so Resend retries once — worth it in case this was a transient
    // Claude/network failure rather than genuinely unparseable content, since a
    // dropped booking email here is silent by definition (nobody's waiting on this
    // request the way an interactive upload has a user watching it fail).
    return new Response('Extraction failed', { status: 500 })
  }

  const { error: insertError } = await supabase.from('pending_reservation_imports').insert({
    trip_id: trip.id,
    sender_email: event.data.from,
    subject: event.data.subject ?? null,
    extracted: result.result,
  })

  if (insertError) {
    console.error('inbound-email: failed to store pending import', trip.id, insertError)
    return new Response('Failed to store import', { status: 500 })
  }

  return new Response('OK', { status: 200 })
}

function extractLocalPart(address: string): string | null {
  const at = address.indexOf('@')
  if (at <= 0) return null
  return address.slice(0, at).trim().toLowerCase()
}

async function buildContentBlock(
  email: ResendReceivedEmail,
  resendApiKey: string,
  emailId: string,
): Promise<ContentBlockParam | null> {
  const supportedAttachment = email.attachments?.find(
    (attachment) =>
      attachment.content_type === 'application/pdf' || ALLOWED_IMAGE_TYPES.includes(attachment.content_type),
  )

  if (supportedAttachment) {
    if (supportedAttachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
      console.log('inbound-email: attachment too large, skipping', emailId, supportedAttachment.size)
      return null
    }

    const attachmentResponse = await fetch(
      `${RESEND_API_BASE}/emails/receiving/${emailId}/attachments/${supportedAttachment.id}`,
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

    return supportedAttachment.content_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: supportedAttachment.content_type, data: base64 } }
  }

  const text = (email.text ?? stripHtml(email.html ?? '')).trim()
  if (text.length < MIN_TEXT_BODY_LENGTH) return null
  return { type: 'text', text }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
