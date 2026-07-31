// SSRF-guarded fetch for the URL/crawling import channel (TABI-193). A user-supplied URL is
// fetched server-side, so without guards a malicious link could be used to probe or reach
// internal/cloud-metadata services from our server. Mitigations here are best-effort, not
// complete: Vercel's Edge runtime has no DNS module, so we can only reject obviously-private
// hostnames/IP literals up front — we cannot resolve a public-looking hostname ourselves and
// verify the IP it actually resolves to, so DNS-rebinding (a hostname that resolves to a public
// IP at request time but a private one when actually fetched) is not defended against. Full
// protection would need a DNS-resolving proxy layer; treat that as a follow-up if this channel
// sees abuse, not a blocker for a first cut.
const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '[::1]', '::1'])

const PRIVATE_IPV4_PREFIXES = [
  /^127\./, // loopback
  /^10\./, // private
  /^172\.(1[6-9]|2\d|3[01])\./, // private
  /^192\.168\./, // private
  /^169\.254\./, // link-local, incl. cloud metadata (169.254.169.254)
  /^0\./, // "this network"
]

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024 // 2MB — a confirmation page has no reason to exceed this
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 8000
const MAX_EXTRACTED_TEXT_CHARS = 40000

export type UrlFetchResult = { text: string } | { error: string }

export async function fetchUrlAsText(rawUrl: string): Promise<UrlFetchResult> {
  let currentUrl = rawUrl
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const validation = validateUrl(currentUrl)
    if ('error' in validation) return validation

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(validation.url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/html,text/plain' },
      })
    } catch (error) {
      console.error('urlFetch: fetch failed', error)
      return { error: 'Could not reach this URL' }
    } finally {
      clearTimeout(timeout)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location')
      if (!location) return { error: 'This URL redirected without a destination' }
      currentUrl = new URL(location, validation.url).toString()
      continue
    }

    if (!response.ok) {
      return { error: `This URL returned an error (${response.status})` }
    }

    const contentType = response.headers.get('Content-Type') ?? ''
    if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { error: 'This URL did not return a readable web page' }
    }

    const body = await readBodyCapped(response, MAX_RESPONSE_BYTES)
    if ('error' in body) return body

    const text = htmlToText(body.text).slice(0, MAX_EXTRACTED_TEXT_CHARS)
    if (!text.trim()) return { error: 'Could not find any readable content on this page' }
    return { text }
  }

  return { error: 'Too many redirects' }
}

function validateUrl(rawUrl: string): { url: URL } | { error: string } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { error: 'Enter a valid URL' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'URL must start with http:// or https://' }
  }

  if (url.username || url.password) {
    return { error: 'URL must not include embedded credentials' }
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    return { error: 'Unsupported URL port' }
  }

  const hostname = url.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return { error: 'This URL is not allowed' }
  }
  if (PRIVATE_IPV4_PREFIXES.some((pattern) => pattern.test(hostname))) {
    return { error: 'This URL is not allowed' }
  }
  if (hostname === '[::1]' || hostname.startsWith('[fc') || hostname.startsWith('[fd') || hostname.startsWith('[fe8')) {
    return { error: 'This URL is not allowed' }
  }

  return { url }
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<{ text: string } | { error: string }> {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    return text.length > maxBytes ? { error: 'This page is too large' } : { text }
  }

  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    if (bytesRead > maxBytes) {
      reader.cancel()
      return { error: 'This page is too large' }
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return { text }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
}

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  const withoutTags = withoutNoise.replace(/<[^>]+>/g, ' ')
  const decoded = withoutTags.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_match, name) => HTML_ENTITIES[name] ?? ' ')
  return decoded.replace(/\s+/g, ' ').trim()
}
