// Server-side only — TABI-193: paste a confirmation-page link (Booking.com, an airline ticket
// page, etc.) instead of uploading a PDF or taking a screenshot. Fetches the page server-side
// (SSRF-guarded, see ./_lib/urlFetch.ts), strips it to plain text, and runs it through the same
// Claude extraction pipeline as every other import channel (./_lib/extraction.ts, shared with
// ./extract-reservation.ts) — one pipeline, not a fork per channel.
//
// The fetched page content is treated as untrusted data, same as any imported document (TABI-93)
// — arguably more so, since a web page is more manipulable than a static file a user chose to
// upload themselves.
import { requireEntitlement } from './_lib/entitlements.js'
import { runExtraction, type ExtractResult } from './_lib/extraction.js'
import { checkRateLimit } from './_lib/rateLimit.js'
import { fetchUrlAsText } from './_lib/urlFetch.js'

interface ImportUrlRequestBody {
  url?: string
}

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('import-url: ANTHROPIC_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const entitlement = await requireEntitlement(request, { feature: 'aiAccess' })
  if (!entitlement.allowed) {
    if (entitlement.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (entitlement.reason === 'denied') {
      return jsonResponse({ error: 'Your plan does not include AI import' }, 403)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const rateLimit = await checkRateLimit(request, 'import-url')
  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily extraction limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: ImportUrlRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const url = body.url?.trim()
  if (!url) {
    return jsonResponse({ error: 'url is required' }, 400)
  }

  const fetched = await fetchUrlAsText(url)
  if ('error' in fetched) {
    return jsonResponse<ExtractResult>({ status: 'error', error: fetched.error })
  }

  const result = await runExtraction(
    { type: 'text', text: fetched.text },
    'Extract this reservation from the confirmation page content above.',
    apiKey,
    'import-url',
  )
  return jsonResponse<ExtractResult>(result)
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
