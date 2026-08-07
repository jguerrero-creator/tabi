// Server-side only — calls the Claude API (Messages, multimodal) directly via
// fetch (not the @anthropic-ai/sdk: it references node:fs/node:path
// internally, which Vercel's edge runtime can't bundle — see TABI-177) with
// the secret ANTHROPIC_API_KEY to pull structured booking fields out of an
// imported confirmation (email text, PDF, or a photo of a ticket/receipt).
// Never call the Claude API from src/. See ./README.md.
//
// The actual Claude call/schema/tool is shared with the URL import channel
// (TABI-193) in ./_lib/extraction.ts — one pipeline, not a fork per channel.
import { requireEntitlement } from './_lib/entitlements.js'
import type { ContentBlockParam } from './_lib/extraction.js'
import { runExtraction, type ExtractResult } from './_lib/extraction.js'
import { checkRateLimit } from './_lib/rateLimit.js'

type ExtractKind = 'text' | 'pdf' | 'image'

interface ExtractRequestBody {
  kind?: ExtractKind
  text?: string
  data?: string
  mediaType?: string
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('extract-reservation: ANTHROPIC_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  // Run entitlement + rate-limit checks concurrently rather than sequentially — each is its own
  // Supabase round trip, and running them one after another eats into the 25s Edge budget before
  // the (already latency-sensitive, see TABI-8) Claude call even starts.
  const [entitlement, rateLimit] = await Promise.all([
    requireEntitlement(request, { feature: 'aiAccess' }),
    checkRateLimit(request, 'extract-reservation'),
  ])

  if (!entitlement.allowed) {
    if (entitlement.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (entitlement.reason === 'denied') {
      return jsonResponse({ error: 'Your plan does not include AI import' }, 403)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  if (!rateLimit.allowed) {
    if (rateLimit.reason === 'unauthenticated') {
      return jsonResponse({ error: 'Authentication required' }, 401)
    }
    if (rateLimit.reason === 'exceeded') {
      return jsonResponse({ error: 'Daily extraction limit reached — try again tomorrow' }, 429)
    }
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: ExtractRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const contentBlock = buildContentBlock(body)
  if ('error' in contentBlock) {
    return jsonResponse({ error: contentBlock.error }, 400)
  }

  const result = await runExtraction(contentBlock.block, 'Extract this reservation.', apiKey, 'extract-reservation')
  return jsonResponse<ExtractResult>(result)
}

function buildContentBlock(body: ExtractRequestBody): { block: ContentBlockParam } | { error: string } {
  if (body.kind === 'text') {
    const text = body.text?.trim()
    if (!text) return { error: 'text is required for kind "text"' }
    return { block: { type: 'text', text } }
  }

  if (body.kind === 'pdf') {
    const data = body.data?.trim()
    if (!data) return { error: 'data is required for kind "pdf"' }
    return { block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } }
  }

  if (body.kind === 'image') {
    const data = body.data?.trim()
    if (!data) return { error: 'data is required for kind "image"' }
    const mediaType = body.mediaType
    if (!mediaType || !ALLOWED_IMAGE_TYPES.includes(mediaType)) {
      return { error: `mediaType must be one of ${ALLOWED_IMAGE_TYPES.join(', ')}` }
    }
    return {
      block: { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
    }
  }

  return { error: 'kind must be "text", "pdf", or "image"' }
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
