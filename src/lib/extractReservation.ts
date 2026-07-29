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

async function extract(body: Record<string, unknown>): Promise<ExtractedReservation> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  const response = await fetch('/api/extract-reservation', {
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
