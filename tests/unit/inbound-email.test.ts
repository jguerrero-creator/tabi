import { test } from 'node:test'
import assert from 'node:assert'
import {
  buildAttachmentFallbackBlock,
  buildBodyContentBlock,
  isEmptyExtraction,
  selectFallbackAttachment,
  type ResendReceivedEmail,
} from '../../api/inbound-email.ts'
import type { ExtractedReservation } from '../../api/_lib/extraction.ts'

// Fixture shaped like the real "Import par email" bug report: a GetYourGuide activity
// confirmation forwarded by a third party (not Julian himself), carrying the complete
// booking in its plain-text body plus two genuinely-attached (non-inline) files — a
// generic Terms & Conditions PDF (which appears first) and a meeting-point photo. Real
// email, Resend ID 40fc6bf3-cdaa-46ee-88ef-1e652b8cb73d, received 2026-10-06.
const GYG_BODY_TEXT = `
October 28, 2026 at 11:00 AM

Pixel Lab Tokyo: Gameboy Mod Workshop (Classic/Advance/SP)

Tokyo: Gameboy Advance IPS Modding Workshop

2 Adults (Age 0 - 99) - English - 3 hours

EUR 631.92

Where to go

6-chome-11-19 Sotokanda, Chiyoda City, Tokyo 101-0021, Japan

The guide will wait for you at Chiyoda City Rensei Park.

When to arrive

10:45 AM - Arrive at the meeting point 15 minutes before your chosen time so you don't
lose your time slot.

Booking reference

GYG996RR7LRQ
`.trim()

const gygFixtureEmail: ResendReceivedEmail = {
  text: GYG_BODY_TEXT,
  html: null,
  attachments: [
    {
      id: 'att-terms',
      filename: 'GYG_Terms_Conditions_en-GB.pdf',
      content_type: 'application/pdf',
      content_disposition: 'attachment',
      size: 164401,
    },
    {
      id: 'att-meeting-point',
      filename: 'meeting-point-GYG996RR7LRQ.jpg',
      content_type: 'image/jpeg',
      content_disposition: 'attachment',
      size: 40090,
    },
  ],
}

test('buildBodyContentBlock: picks the email text body over a non-inline T&Cs PDF attachment', () => {
  // This is the actual regression: the pre-fix buildContentBlock() scanned attachments
  // FIRST and returned the Terms & Conditions PDF (content_disposition: 'attachment', so
  // the 09-21 inline filter didn't catch it) without ever looking at the body — a generic
  // legal document with zero booking facts, which is exactly why extraction came back
  // all-null for this email in production. The fix makes the body the primary source;
  // an attachment is only ever reached for as a fallback, not scanned first.
  const block = buildBodyContentBlock(gygFixtureEmail)
  assert.ok(block, 'expected a content block from a non-empty body')
  assert.equal(block.type, 'text')
  assert.match(block.text, /Gameboy Advance IPS Modding Workshop/)
  assert.match(block.text, /GYG996RR7LRQ/)
  assert.match(block.text, /Chiyoda City Rensei Park/)
})

test('buildBodyContentBlock: returns null when there is no text and no HTML to fall back to', () => {
  const block = buildBodyContentBlock({ text: null, html: null, attachments: [] })
  assert.equal(block, null)
})

test('buildBodyContentBlock: falls back to a stripped HTML body when there is no plain text', () => {
  const block = buildBodyContentBlock({
    text: null,
    html: '<p>Your activity: <b>Tokyo: Gameboy Advance IPS Modding Workshop</b></p>',
    attachments: [],
  })
  assert.ok(block)
  assert.equal(block.type, 'text')
  assert.match(block.text, /Gameboy Advance IPS Modding Workshop/)
})

test('selectFallbackAttachment: still picks the non-inline PDF first, per the 2026-09-21 inline-filter/size-floor fix', () => {
  // Confirms the fallback path (reached only when the body comes back empty, or is
  // missing entirely) kept the exact 09-21 selection rules rather than picking the
  // meeting-point photo, or an inline logo, instead.
  const picked = selectFallbackAttachment(gygFixtureEmail.attachments)
  assert.equal(picked?.filename, 'GYG_Terms_Conditions_en-GB.pdf')
})

test('selectFallbackAttachment: still excludes inline attachments (2026-09-21 Outlook-logo regression)', () => {
  const picked = selectFallbackAttachment([
    { id: 'logo', filename: 'ATT00001.png', content_type: 'image/png', content_disposition: 'inline', size: 4000 },
  ])
  assert.equal(picked, null)
})

test('buildAttachmentFallbackBlock: fetches and base64-encodes the selected attachment', async () => {
  const originalFetch = globalThis.fetch
  const calledUrls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calledUrls.push(url)
    if (url.includes('/attachments/')) {
      return new Response(JSON.stringify({ download_url: 'https://cdn.resend.app/fake-download' }), { status: 200 })
    }
    if (url === 'https://cdn.resend.app/fake-download') {
      return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 })
    }
    throw new Error(`unexpected fetch in test: ${url}`)
  }) as typeof fetch

  try {
    const block = await buildAttachmentFallbackBlock(gygFixtureEmail, 'fake-resend-key', 'test-email-id')
    assert.ok(block)
    assert.equal(block.type, 'document')
    assert.ok(calledUrls.some((u) => u.includes('test-email-id') && u.includes('att-terms')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

function extractedReservation(overrides: Partial<ExtractedReservation>): ExtractedReservation {
  return {
    type: null,
    staySubtype: null,
    transportSubtype: null,
    transportMode: null,
    name: null,
    startAddress: null,
    endAddress: null,
    startDateTime: null,
    endDateTime: null,
    confirmationNumber: null,
    price: null,
    ...overrides,
  }
}

test('isEmptyExtraction: true when every field is null (the production symptom for this bug)', () => {
  assert.equal(isEmptyExtraction(extractedReservation({})), true)
})

test('isEmptyExtraction: true for a weak type guess with no name and no date', () => {
  assert.equal(isEmptyExtraction(extractedReservation({ type: 'activity' })), true)
})

test('isEmptyExtraction: false once a name and a start date are present', () => {
  assert.equal(
    isEmptyExtraction(
      extractedReservation({
        type: 'activity',
        name: 'Tokyo: Gameboy Advance IPS Modding Workshop',
        startDateTime: '2026-10-28T11:00:00',
      }),
    ),
    false,
  )
})
