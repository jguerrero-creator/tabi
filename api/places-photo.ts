// Server-side only — proxies the Places API (New) Photo Media endpoint with
// the secret GOOGLE_MAPS_API_KEY. Never call this API from src/. See ./README.md.
//
// TABI-49: an <img> tag can't carry an Authorization header, so this endpoint
// can't use the Bearer-token pattern the other api/* functions use — instead
// it validates the `ref` shape strictly before ever forwarding it to Google,
// so it can't be used as an open server-side fetch proxy for arbitrary input.

const PHOTO_REF_PATTERN = /^places\/[^/]+\/photos\/[^/]+$/
const MIN_WIDTH = 100
const MAX_WIDTH = 800
const DEFAULT_WIDTH = 400

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    console.error('places-photo: GOOGLE_MAPS_API_KEY is not configured')
    return new Response('Server misconfigured', { status: 500 })
  }

  const url = new URL(request.url)
  const ref = url.searchParams.get('ref') ?? ''
  if (!PHOTO_REF_PATTERN.test(ref)) {
    return new Response('Invalid photo reference', { status: 400 })
  }
  const width = clamp(Number(url.searchParams.get('w')) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH)

  const mediaUrl = `https://places.googleapis.com/v1/${ref}/media?key=${apiKey}&maxWidthPx=${width}`

  let googleResponse: Response
  try {
    googleResponse = await fetch(mediaUrl)
  } catch (error) {
    console.error('places-photo: Photo Media API request failed', error)
    return new Response('Failed to fetch photo', { status: 502 })
  }

  if (!googleResponse.ok || !googleResponse.body) {
    console.error('places-photo: Photo Media API HTTP error', googleResponse.status)
    return new Response('Failed to fetch photo', { status: 502 })
  }

  return new Response(googleResponse.body, {
    status: 200,
    headers: {
      'Content-Type': googleResponse.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
