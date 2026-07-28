import type { ExtractedReservation } from '../types/extractedReservation'

export class ExtractionFailedError extends Error {}

export async function extractReservationFromText(text: string): Promise<ExtractedReservation> {
  const response = await fetch('/api/extract-reservation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'text', text }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new ExtractionFailedError(errorBody?.error ?? 'Failed to extract reservation')
  }

  const body = await response.json()
  if (body.status !== 'ok') {
    throw new ExtractionFailedError(body.error ?? 'Extraction failed')
  }

  return body.result as ExtractedReservation
}
