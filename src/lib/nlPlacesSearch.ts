import { supabase } from './supabase'
import type { PlacesFilter } from '../types/placesFilter'

export class PlacesFilterFailedError extends Error {}

// TABI-79: translates a traveler's free-text search request into structured Google Places
// filters via Claude — never a place itself (Decision Log, 2026-07-16: "L'IA traduit
// l'intention en filtres, elle ne génère jamais elle-même de lieux"). The caller feeds the
// returned intents into the existing searchPlaces() (./placesSearch.ts), exactly like a
// manually-typed query.
export async function translateSearchIntent(query: string): Promise<PlacesFilter> {
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  const headers = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
  const requestBody = JSON.stringify({ query })

  let response: Response
  try {
    response = await fetch('/api/nl-places-search', { method: 'POST', headers, body: requestBody })
    if (response.status === 504) {
      response = await fetch('/api/nl-places-search', { method: 'POST', headers, body: requestBody })
    }
  } catch (error) {
    console.error('nlPlacesSearch: network error', error)
    throw new PlacesFilterFailedError('Failed to understand that search')
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new PlacesFilterFailedError(errorBody?.error ?? 'Failed to understand that search')
  }

  const responseBody = await response.json()
  if (responseBody.status !== 'ok') {
    throw new PlacesFilterFailedError(responseBody.error ?? 'Failed to understand that search')
  }

  return responseBody.result as PlacesFilter
}
