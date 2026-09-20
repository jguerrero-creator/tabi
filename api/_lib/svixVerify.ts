// Edge-compatible Svix webhook signature verification, used by api/inbound-email.ts to
// authenticate Resend's `email.received` webhook. Deliberately implemented with Web
// Crypto only, not the `svix` npm package — same caution as extraction.ts's own comment
// about @anthropic-ai/sdk breaking Vercel's Edge runtime (Node-oriented SDKs are a real,
// repeated risk here, not a hypothetical one), and Svix's scheme is simple enough
// (HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64) that reimplementing it avoids
// pulling in an unaudited dependency for three lines of actual crypto.
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifySvixSignature(params: {
  secret: string
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
  body: string
}): Promise<boolean> {
  const { secret, svixId, svixTimestamp, svixSignature, body } = params
  if (!svixId || !svixTimestamp || !svixSignature) return false

  const timestampSeconds = Number(svixTimestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  // Rejects a replayed old payload — the signature alone never expires on its own.
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) return false

  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''))
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signedContent = `${svixId}.${svixTimestamp}.${body}`
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = bytesToBase64(new Uint8Array(signatureBytes))

  // svix-signature is space-separated "v1,<base64>" values (more than one during a
  // signing-secret rotation) — valid if any one matches.
  return svixSignature
    .split(' ')
    .map((part) => part.split(',')[1])
    .filter((sig): sig is string => Boolean(sig))
    .some((sig) => timingSafeEqual(sig, expected))
}
