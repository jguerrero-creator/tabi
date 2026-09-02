import { useCallback, useRef, useState } from 'react'
import { AdvancedMarker, Map, useMap } from '@vis.gl/react-google-maps'
import type { MapPoint } from '../../components/ui/MiniMap'
import { mapCameraFor, MapTrace, MiniMap } from '../../components/ui/MiniMap'
import { MapErrorBoundary } from '../../components/ui/MapErrorBoundary'
import { Spinner } from '../../components/ui/Spinner'
import { mapId, mapsApiKey } from '../../lib/googleMaps'
import { logClientError } from '../../lib/logError'
import { searchNearbyPlaces, type PlaceSearchResult } from '../../lib/placesSearch'
import { strings } from '../../lib/strings'

const FULLSCREEN_MAP_ID = 'overview-fullscreen-map'
// TABI-135: re-query only once the viewport has moved by a meaningful fraction of
// its own radius, so panning/zooming while exploring doesn't re-fire the Places
// call on every settle — a manual toggle-on plus this gate is the whole refresh
// strategy (see CLAUDE.md rate-limit guidance and api/_lib/rateLimit.ts's shared
// per-user daily quota, which this reuses via places-nearby's 'tourist' mode).
const SIGNIFICANT_MOVE_RATIO = 0.3

interface OverviewMapProps {
  points: MapPoint[]
}

export function OverviewMap({ points }: OverviewMapProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const [showTouristPlaces, setShowTouristPlaces] = useState(false)
  const [touristPlaces, setTouristPlaces] = useState<PlaceSearchResult[]>([])
  const [touristLoading, setTouristLoading] = useState(false)
  const [touristError, setTouristError] = useState<string | null>(null)
  const lastQueryRef = useRef<{ lat: number; lng: number; radius: number } | null>(null)
  const fullscreenMap = useMap(FULLSCREEN_MAP_ID)
  const canExpand = Boolean(mapsApiKey) && points.length > 0

  const loadTouristPlaces = useCallback((map: google.maps.Map) => {
    const bounds = map.getBounds()
    if (!bounds) return
    const center = bounds.getCenter()
    const radius = boundsRadiusMeters(bounds)

    const last = lastQueryRef.current
    if (last && distanceMeters({ lat: center.lat(), lng: center.lng() }, last) < last.radius * SIGNIFICANT_MOVE_RATIO) {
      return
    }
    lastQueryRef.current = { lat: center.lat(), lng: center.lng(), radius }

    setTouristLoading(true)
    setTouristError(null)
    searchNearbyPlaces(center.lat(), center.lng(), { mode: 'tourist', radius })
      .then(setTouristPlaces)
      .catch((err) => {
        logClientError('OverviewMap.loadTouristPlaces', err)
        setTouristError(strings.overview.touristPlacesError)
      })
      .finally(() => setTouristLoading(false))
  }, [])

  function handleToggleTouristPlaces() {
    setShowTouristPlaces((wasShown) => {
      const nowShown = !wasShown
      if (!nowShown) {
        setTouristPlaces([])
        setTouristError(null)
        lastQueryRef.current = null
      } else if (fullscreenMap) {
        loadTouristPlaces(fullscreenMap)
      }
      return nowShown
    })
  }

  return (
    <div className="relative">
      <MiniMap points={points} heightClassName="h-40 lg:h-[calc(100vh-8rem)]" />
      {canExpand && (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label={strings.overview.expandMap}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white"
        >
          ⤢
        </button>
      )}

      {fullscreen && mapsApiKey && (
        <div className="fixed inset-0 z-50 bg-black">
          <MapErrorBoundary heightClassName="h-full" className="rounded-none border-0">
            <Map
              id={FULLSCREEN_MAP_ID}
              mapId={mapId}
              {...mapCameraFor(points, 11, 48)}
              gestureHandling="greedy"
              onIdle={(event) => {
                if (showTouristPlaces) loadTouristPlaces(event.map)
              }}
            >
              <MapTrace points={points} />
              {showTouristPlaces &&
                touristPlaces.map((place) => (
                  <AdvancedMarker
                    key={place.googlePlaceId}
                    position={{ lat: place.lat, lng: place.lng }}
                    title={place.name}
                  >
                    <span className="block h-4 w-4 rounded-full border-2 border-sky-500 bg-white/90 shadow-sm" />
                  </AdvancedMarker>
                ))}
            </Map>
          </MapErrorBoundary>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label={strings.common.back}
            className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={handleToggleTouristPlaces}
            className={`absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow ${
              showTouristPlaces ? 'bg-sky-600 text-white' : 'bg-white/90 text-slate-700'
            }`}
          >
            {touristLoading && <Spinner />}
            {showTouristPlaces ? strings.overview.hideTouristPlaces : strings.overview.showTouristPlaces}
          </button>
          {touristError && (
            <p className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs text-red-600 shadow">
              {touristError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const EARTH_RADIUS_METERS = 6371000

// Haversine distance — used instead of the Maps JS 'geometry' library so TABI-135
// doesn't grow googleMaps.ts's MAPS_LIBRARIES array (see its comment on why a
// stable identity there matters) just for two distance calls.
function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}

// Approximates the visible viewport as a circle (center -> NE corner) since Places
// API (New) Nearby Search only accepts a circular locationRestriction, not a rectangle.
function boundsRadiusMeters(bounds: google.maps.LatLngBounds): number {
  const center = bounds.getCenter()
  const northEast = bounds.getNorthEast()
  return distanceMeters({ lat: center.lat(), lng: center.lng() }, { lat: northEast.lat(), lng: northEast.lng() })
}
