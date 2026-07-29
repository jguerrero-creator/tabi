import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { localDateKey, localTimeZone } from '../../lib/datetime'
import { fetchGeocodeByPlaceId } from '../../lib/geocode'
import { logClientError } from '../../lib/logError'
import { placePhotoUrl, searchPlaces, type PlaceSearchBias, type PlaceSearchResult } from '../../lib/placesSearch'
import { strings } from '../../lib/strings'
import type { ResolvedPlace } from './AddReservationModal'
import { useTrip } from '../trips/useTrip'
import { useTripDayLocations } from '../trips/useTripDayLocations'

const DEBOUNCE_MS = 250

interface ActivityPlaceSearchModalProps {
  tripId: string
  onSelect: (place: ResolvedPlace) => void
  onSkip: () => void
  onCancel: () => void
}

// TABI-49: rich Google Places search launched first from the Activities menu's Add
// flow (Decision Log: distinct from the plain address-autocomplete used elsewhere).
// Text Search (New) doesn't return a timezone, so picking a result resolves it through
// the existing /api/geocode place-id lookup (the same call the plain-autocomplete path
// already uses) before handing a fully-formed ResolvedPlace back to the caller.
// "Enter manually instead" skips straight to the existing blank form.
export function ActivityPlaceSearchModal({ tripId, onSelect, onSkip, onCancel }: ActivityPlaceSearchModalProps) {
  const { trip } = useTrip(tripId)
  const { locationsByDate } = useTripDayLocations(tripId)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function handleChange(text: string) {
    setQuery(text)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!text.trim()) {
      requestIdRef.current += 1
      setResults([])
      setLoading(false)
      setError(null)
      setSearched(false)
      return
    }

    debounceRef.current = setTimeout(() => runSearch(text), DEBOUNCE_MS)
  }

  async function runSearch(text: string) {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    try {
      const bias = computeBias()
      const found = await searchPlaces(text, bias)
      if (requestId !== requestIdRef.current) return
      setResults(found)
      setSearched(true)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      logClientError('ActivityPlaceSearchModal.runSearch', err)
      setError(strings.activityPlaceSearch.errorGeneric)
      setResults([])
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  async function handleSelectResult(result: PlaceSearchResult) {
    setResolvingPlaceId(result.googlePlaceId)
    setError(null)
    try {
      const geocoded = await fetchGeocodeByPlaceId(result.googlePlaceId)
      onSelect({
        ...geocoded,
        placeName: result.name,
        placeDetails: {
          googlePlaceId: result.googlePlaceId,
          rating: result.rating,
          userRatingsTotal: result.userRatingsTotal,
          photoRef: result.photoRef,
          category: result.category,
        },
      })
    } catch (err) {
      logClientError('ActivityPlaceSearchModal.handleSelectResult', err)
      setError(strings.activityPlaceSearch.errorGeneric)
      setResolvingPlaceId(null)
    }
  }

  function computeBias(): PlaceSearchBias {
    const todayKey = localDateKey(new Date().toISOString(), localTimeZone())
    const todayLocation = locationsByDate.get(todayKey)
    if (todayLocation) return { lat: todayLocation.lat, lng: todayLocation.lng }

    const sortedKeys = Array.from(locationsByDate.keys()).sort()
    const earliest = sortedKeys.length > 0 ? locationsByDate.get(sortedKeys[0]) : undefined
    if (earliest) return { lat: earliest.lat, lng: earliest.lng }

    const regionCode = trip?.destinations[0]
    if (regionCode) return { regionCode }

    return null
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{strings.activityPlaceSearch.title}</h2>

        <label htmlFor="activity-place-search" className="mb-1 block text-sm font-medium text-slate-700">
          {strings.activityPlaceSearch.searchLabel}
        </label>
        <input
          id="activity-place-search"
          value={query}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={strings.activityPlaceSearch.searchPlaceholder}
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
        />

        <div className="mt-3 flex-1 space-y-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
              <Spinner />
              <span className="text-sm">{strings.activityPlaceSearch.loading}</span>
            </div>
          )}

          {!loading && error && <p className="py-4 text-center text-sm text-red-600">{error}</p>}

          {!loading && !error && searched && results.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-500">{strings.activityPlaceSearch.emptyResults}</p>
          )}

          {!loading && !error && results.length > 0 && (
            <div role="radiogroup" className="space-y-2">
              {results.map((result) => (
                <button
                  key={result.googlePlaceId}
                  type="button"
                  role="radio"
                  aria-checked={false}
                  disabled={resolvingPlaceId !== null}
                  onClick={() => handleSelectResult(result)}
                  className="flex w-full items-start gap-3 rounded-lg border border-slate-300 bg-white p-3 text-left transition-colors hover:border-teal-600 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resolvingPlaceId === result.googlePlaceId ? (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center">
                      <Spinner />
                    </div>
                  ) : result.photoRef ? (
                    <img
                      src={placePhotoUrl(result.photoRef, 100)}
                      alt=""
                      className="h-14 w-14 flex-shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="h-14 w-14 flex-shrink-0 rounded-md bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{result.name}</p>
                    <p className="truncate text-xs text-slate-500">{result.formattedAddress}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {result.rating !== null && (
                        <span className="text-xs font-medium text-amber-700">
                          {strings.activityPlaceSearch.ratingLabel(result.rating, result.userRatingsTotal ?? 0)}
                        </span>
                      )}
                      {result.category && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {result.category}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onSkip} className="text-sm font-medium text-teal-700 underline">
            {strings.activityPlaceSearch.manualFallbackCta}
          </button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {strings.activityPlaceSearch.cancel}
          </Button>
        </div>
      </div>
    </div>
  )
}
