import { AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { MapErrorBoundary } from '../../components/ui/MapErrorBoundary'
import { PlaceAutocompleteField, type PlaceAutocompleteSelection } from '../../components/ui/PlaceAutocompleteField'
import { Spinner } from '../../components/ui/Spinner'
import { fetchGeocodeByPlaceId } from '../../lib/geocode'
import { mapId, mapsApiKey } from '../../lib/googleMaps'
import { logClientError } from '../../lib/logError'
import { fetchPlaceOpeningHours } from '../../lib/placeOpeningHours'
import { placePhotoUrl, searchNearbyPlaces, type PlaceSearchResult } from '../../lib/placesSearch'
import { strings } from '../../lib/strings'
import type { ResolvedPlace } from './AddReservationModal'

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
//
// A side list (TABI-24 follow-up) mirrors the map results so comparing options
// doesn't require clicking every pin, and a "Change location" search lets the
// user explore a different area on the fly without touching the day's planned
// location — the automatic centering from the caller is just the starting point,
// not the only way to steer this screen.
export function NearbyPlacesMapModal({ center, onSelect, onSkip, onCancel }: NearbyPlacesMapModalProps) {
  const [effectiveCenter, setEffectiveCenter] = useState(center)
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PlaceSearchResult | null>(null)
  const [resolving, setResolving] = useState(false)
  const [changeLocationText, setChangeLocationText] = useState('')
  const [changeLocationError, setChangeLocationError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    searchNearbyPlaces(effectiveCenter.lat, effectiveCenter.lng)
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
  }, [effectiveCenter.lat, effectiveCenter.lng])

  async function handleChangeLocation(selection: PlaceAutocompleteSelection) {
    setChangeLocationError(null)
    try {
      const geocoded = await fetchGeocodeByPlaceId(selection.placeId)
      setEffectiveCenter({ lat: geocoded.lat, lng: geocoded.lng })
      setSelected(null)
    } catch (err) {
      logClientError('NearbyPlacesMapModal.handleChangeLocation', err)
      setChangeLocationError(strings.nearbyPlaces.changeLocationError)
    }
  }

  async function handleAdd() {
    if (!selected) return
    setResolving(true)
    setError(null)
    try {
      const [geocoded, openingHours] = await Promise.all([
        fetchGeocodeByPlaceId(selected.googlePlaceId),
        // TABI-89: opening hours are a nice-to-have enrichment, not required to attach
        // the place — a lookup failure falls back to null rather than blocking selection.
        fetchPlaceOpeningHours(selected.googlePlaceId).catch((err) => {
          logClientError('NearbyPlacesMapModal.fetchPlaceOpeningHours', err)
          return null
        }),
      ])
      onSelect({
        ...geocoded,
        placeName: selected.name,
        placeDetails: {
          googlePlaceId: selected.googlePlaceId,
          rating: selected.rating,
          userRatingsTotal: selected.userRatingsTotal,
          photoRef: selected.photoRef,
          category: selected.category,
          openingHours,
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
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-white p-6 sm:max-w-2xl sm:rounded-2xl">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">{strings.nearbyPlaces.title}</h2>

        <PlaceAutocompleteField
          id="nearby-places-change-location"
          label={strings.nearbyPlaces.changeLocationLabel}
          value={changeLocationText}
          onTextChange={setChangeLocationText}
          onPlaceSelect={handleChangeLocation}
          placeholder={strings.nearbyPlaces.changeLocationPlaceholder}
          className="mb-3"
        />
        {changeLocationError && <p className="mb-3 text-sm text-red-600">{changeLocationError}</p>}

        {/* Deliberately no flex-1 here: this row's height must come from sm:h-96 itself, not
            from growing to fill the modal (which has no fixed height of its own — only a
            max-h cap) — flex-1's flex-basis:0 would otherwise collapse the row to near-zero
            at the sm+ breakpoint since there's no free space for it to grow into. */}
        <div className="flex flex-col gap-3 overflow-hidden sm:h-96 sm:flex-row">
          <div className="relative h-56 w-full flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 sm:h-full sm:w-1/2">
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
                <Map
                  key={`${effectiveCenter.lat}-${effectiveCenter.lng}`}
                  mapId={mapId}
                  reuseMaps
                  defaultCenter={effectiveCenter}
                  defaultZoom={15}
                  gestureHandling="greedy"
                  disableDefaultUI
                >
                  <AdvancedMarker position={effectiveCenter}>
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
              </MapErrorBoundary>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto sm:h-full sm:w-1/2">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
                <Spinner />
                <span className="text-sm">{strings.nearbyPlaces.loading}</span>
              </div>
            )}

            {!loading && !error && results.length === 0 && (
              <p className="py-3 text-center text-sm text-slate-500">{strings.nearbyPlaces.emptyResults}</p>
            )}

            {!loading && !error && results.length > 0 && (
              <div role="listbox" aria-label={strings.nearbyPlaces.listLabel} className="space-y-2">
                {results.map((result) => (
                  <button
                    key={result.googlePlaceId}
                    type="button"
                    role="option"
                    aria-selected={selected?.googlePlaceId === result.googlePlaceId}
                    onClick={() => setSelected(result)}
                    className={`flex w-full items-start gap-3 rounded-lg border p-2 text-left transition-colors ${
                      selected?.googlePlaceId === result.googlePlaceId
                        ? 'border-teal-600 bg-teal-50'
                        : 'border-slate-200 hover:border-teal-400 hover:bg-slate-50'
                    }`}
                  >
                    {result.photoRef ? (
                      <img
                        src={placePhotoUrl(result.photoRef, 80)}
                        alt=""
                        className="h-12 w-12 flex-shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="h-12 w-12 flex-shrink-0 rounded-md bg-slate-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{result.name}</p>
                      <p className="truncate text-xs text-slate-500">{result.formattedAddress}</p>
                      {result.rating !== null && (
                        <p className="mt-0.5 text-xs font-medium text-amber-700">
                          {strings.nearbyPlaces.ratingLabel(result.rating, result.userRatingsTotal ?? 0)}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

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
