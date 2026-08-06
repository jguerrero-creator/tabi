import { AdvancedMarker, APIProvider, Map } from '@vis.gl/react-google-maps'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { MapErrorBoundary } from '../../components/ui/MapErrorBoundary'
import { Spinner } from '../../components/ui/Spinner'
import { fetchGeocodeByPlaceId } from '../../lib/geocode'
import { logClientError } from '../../lib/logError'
import { placePhotoUrl, searchNearbyPlaces, type PlaceSearchResult } from '../../lib/placesSearch'
import { strings } from '../../lib/strings'
import type { ResolvedPlace } from './AddReservationModal'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID'

interface NearbyPlacesMapModalProps {
  center: { lat: number; lng: number }
  onSelect: (place: ResolvedPlace) => void
  onSkip: () => void
  onCancel: () => void
}

// TABI-24: the free-block "+ Add" opens this map, centered on the day's active
// context (accommodation, or the day's planned location — resolved by the caller
// via resolveContextualLocation), instead of the plain text-search list used by
// the Activities menu (ActivityPlaceSearchModal). Selecting a marker resolves the
// same ResolvedPlace shape through the same /api/geocode place-id lookup, so it
// reuses the Activity/Place model exactly. "Enter manually instead" skips straight
// to the existing TABI-54 blank form, same fallback as the text-search modal.
export function NearbyPlacesMapModal({ center, onSelect, onSkip, onCancel }: NearbyPlacesMapModalProps) {
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PlaceSearchResult | null>(null)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    searchNearbyPlaces(center.lat, center.lng)
      .then((found) => {
        if (cancelled) return
        setResults(found)
      })
      .catch((err) => {
        if (cancelled) return
        logClientError('NearbyPlacesMapModal.searchNearbyPlaces', err)
        setError(strings.nearbyPlaces.errorGeneric)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng])

  async function handleAdd() {
    if (!selected) return
    setResolving(true)
    setError(null)
    try {
      const geocoded = await fetchGeocodeByPlaceId(selected.googlePlaceId)
      onSelect({
        ...geocoded,
        placeName: selected.name,
        placeDetails: {
          googlePlaceId: selected.googlePlaceId,
          rating: selected.rating,
          userRatingsTotal: selected.userRatingsTotal,
          photoRef: selected.photoRef,
          category: selected.category,
        },
      })
    } catch (err) {
      logClientError('NearbyPlacesMapModal.handleAdd', err)
      setError(strings.nearbyPlaces.errorGeneric)
      setResolving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{strings.nearbyPlaces.title}</h2>

        <div className="relative h-72 w-full overflow-hidden rounded-xl border border-slate-200">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/70 text-slate-500">
              <Spinner />
              <span className="text-sm">{strings.nearbyPlaces.loading}</span>
            </div>
          )}

          {!loading && !mapsApiKey && (
            <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-slate-400">
              {strings.reservationDetail.mapUnavailable}
            </div>
          )}

          {mapsApiKey && (
            <MapErrorBoundary heightClassName="h-full" className="rounded-none border-0">
              <APIProvider apiKey={mapsApiKey} libraries={['marker']}>
                <Map mapId={mapId} defaultCenter={center} defaultZoom={15} gestureHandling="greedy" disableDefaultUI>
                  <AdvancedMarker position={center}>
                    <span className="block h-3 w-3 rounded-full border-2 border-white bg-slate-500 shadow-sm" />
                  </AdvancedMarker>
                  {results.map((result) => (
                    <AdvancedMarker
                      key={result.googlePlaceId}
                      position={{ lat: result.lat, lng: result.lng }}
                      title={result.name}
                      onClick={() => setSelected(result)}
                    >
                      <span
                        className={`block h-5 w-5 rounded-full border-2 border-white shadow-sm ${
                          selected?.googlePlaceId === result.googlePlaceId ? 'bg-teal-700' : 'bg-teal-500'
                        }`}
                      />
                    </AdvancedMarker>
                  ))}
                </Map>
              </APIProvider>
            </MapErrorBoundary>
          )}
        </div>

        {!loading && !error && results.length === 0 && (
          <p className="py-3 text-center text-sm text-slate-500">{strings.nearbyPlaces.emptyResults}</p>
        )}

        {error && <p className="py-3 text-center text-sm text-red-600">{error}</p>}

        {selected && (
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-slate-200 p-3">
            {selected.photoRef ? (
              <img
                src={placePhotoUrl(selected.photoRef, 100)}
                alt=""
                className="h-14 w-14 flex-shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="h-14 w-14 flex-shrink-0 rounded-md bg-slate-100" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{selected.name}</p>
              <p className="truncate text-xs text-slate-500">{selected.formattedAddress}</p>
              {selected.rating !== null && (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  {strings.nearbyPlaces.ratingLabel(selected.rating, selected.userRatingsTotal ?? 0)}
                </p>
              )}
            </div>
            <Button type="button" onClick={handleAdd} disabled={resolving} className="shrink-0">
              {resolving ? <Spinner /> : strings.nearbyPlaces.addCta}
            </Button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onSkip} className="text-sm font-medium text-teal-700 underline">
            {strings.nearbyPlaces.manualFallbackCta}
          </button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {strings.nearbyPlaces.cancel}
          </Button>
        </div>
      </div>
    </div>
  )
}
