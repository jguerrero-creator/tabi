import { supabase } from './supabase'
import type { ExtractedReservation } from '../types/extractedReservation'

export class ExtractionFailedError extends Error {}

export async function extractReservationFromText(text: string): Promise<ExtractedReservation> {
  return extract({ kind: 'text', text })
}

// TABI-23: PDF upload channel — same endpoint and 'pdf' kind api/extract-reservation.ts already
// supported since TABI-8, just not yet wired to a frontend entry point.
export async function extractReservationFromPdf(base64Data: string): Promise<ExtractedReservation> {
  return extract({ kind: 'pdf', data: base64Data })
}

// TABI-58: photo upload channel — same endpoint and 'image' kind api/extract-reservation.ts already
// supported since TABI-8, just not yet wired to a frontend entry point.
export async function extractReservationFromImage(
  base64Data: string,
  mediaType: string,
): Promise<ExtractedReservation> {
  return extract({ kind: 'image', data: base64Data, mediaType })
}

// TABI-193: URL/crawling channel — fetches the page server-side (api/import-url.ts) and runs it
// through the same extraction pipeline. Separate endpoint from the others since it does its own
// SSRF-guarded fetch first, but the same review/correction flow downstream.
export async function extractReservationFromUrl(url: string): Promise<ExtractedReservation> {
  return extract({ url }, '/api/import-url')
}

async function extract(body: Record<string, unknown>, endpoint = '/api/extract-reservation'): Promise<ExtractedReservation> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new ExtractionFailedError(errorBody?.error ?? 'Failed to extract reservation')
  }

  const responseBody = await response.json()
  if (responseBody.status !== 'ok') {
    throw new ExtractionFailedError(responseBody.error ?? 'Extraction failed')
  }

  return responseBody.result as ExtractedReservation
}
