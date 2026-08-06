import { supabase } from './supabase'
import type { ExtractedPlan } from '../types/extractedPlan'

export class PlanExtractionFailedError extends Error {}

// TABI-208: bulk import of a textual travel plan — its own endpoint (api/extract-plan.ts) since
// the output is a list, not a single reservation, but the same auth/error-handling shape as
// src/lib/extractReservation.ts's extract() helper.
export async function extractPlanFromText(text: string): Promise<ExtractedPlan> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  const response = await fetch('/api/extract-plan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ kind: 'text', text }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new PlanExtractionFailedError(errorBody?.error ?? 'Failed to extract travel plan')
  }

  const responseBody = await response.json()
  if (responseBody.status !== 'ok') {
    throw new PlanExtractionFailedError(responseBody.error ?? 'Extraction failed')
  }

  return responseBody.result as ExtractedPlan
}
