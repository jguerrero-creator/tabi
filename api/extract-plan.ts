// Server-side only — calls the Claude API directly via fetch (see ./extract-reservation.ts for
// why not @anthropic-ai/sdk) with the secret ANTHROPIC_API_KEY to pull a LIST of decided
// day-locations/reservations out of a pasted travel plan or exported planning conversation
// (TABI-208). Never call the Claude API from src/. See ./README.md.
//
// The actual Claude call/schema/tool is its own pipeline in ./_lib/extraction.ts
// (runPlanExtraction) — a genuinely different output shape (a list, two item kinds) from the
// single-reservation pipeline, but built on the same shared low-level Claude-call helper so the
// fetch/error-handling/validation logic isn't duplicated.
import { requireEntitlement } from './_lib/entitlements.js'
import type { ContentBlockParam } from './_lib/extraction.js'
import { runPlanExtraction, type ExtractPlanResult } from './_lib/extraction.js'
import { checkRateLimit } from './_lib/rateLimit.js'

interface ExtractPlanRequestBody {
  kind?: 'text'
  text?: string
}

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('extract-plan: ANTHROPIC_API_KEY is not configured')
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

  const rateLimit = await checkRateLimit(request, 'extract-plan')
  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily extraction limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: ExtractPlanRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const text = body.text?.trim()
  if (!text) {
    return jsonResponse({ error: 'text is required' }, 400)
  }

  const contentBlock: ContentBlockParam = { type: 'text', text }
  const result = await runPlanExtraction(contentBlock, 'Extract this travel plan.', apiKey, 'extract-plan')
  return jsonResponse<ExtractPlanResult>(result)
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
