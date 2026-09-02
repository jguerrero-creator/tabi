import { AdvancedMarker, Map, Polyline } from '@vis.gl/react-google-maps'
import { mapId, mapsApiKey } from '../../lib/googleMaps'
import { mapStatusColor } from '../../lib/mapStatusColors'
import { strings } from '../../lib/strings'
import type { ReservationStatus } from '../../types/reservation'
import { MapErrorBoundary } from './MapErrorBoundary'

export interface MapPoint {
  lat: number
  lng: number
  label: string
  /** null for a day-level planned location, which has no booking of its own. */
  status: ReservationStatus | null
}

interface MiniMapProps {
  points: MapPoint[]
  className?: string
  heightClassName?: string
}

export function MiniMap({ points, className = '', heightClassName = 'h-40' }: MiniMapProps) {
  if (!mapsApiKey || points.length === 0) {
    return (
      <div
        className={`flex ${heightClassName} w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-400 ${className}`}
      >
        {strings.reservationDetail.mapUnavailable}
      </div>
    )
  }

  return (
    <div className={`${heightClassName} w-full overflow-hidden rounded-xl border border-slate-200 ${className}`}>
      <MapErrorBoundary heightClassName="h-full" className="rounded-none border-0">
        <Map mapId={mapId} {...mapCameraFor(points, 14, 24)} gestureHandling="cooperative" disableDefaultUI>
          <MapTrace points={points} />
        </Map>
      </MapErrorBoundary>
    </div>
  )
}

export type MapCamera =
  | { defaultCenter: google.maps.LatLngLiteral; defaultZoom: number }
  | { defaultBounds: google.maps.LatLngBoundsLiteral & { padding: number } }

/**
 * Bugfix (Bugs DB: "centerOf(points) calcule probablement une moyenne naïve
 * lat/lng"): a naive lat/lng average — or, for 3+ points, just picking the
 * first one — can land nowhere near any actual point once they're far apart
 * (e.g. Tokyo + Brussels averages to rural Kazakhstan). fitBounds via
 * defaultBounds always frames every point correctly regardless of spread.
 * Single-point trips keep a fixed zoom, since fitBounds on a zero-area bounds
 * doesn't produce a meaningful "wide view" zoom level.
 */
export function mapCameraFor(points: MapPoint[], singlePointZoom: number, padding: number): MapCamera {
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const north = Math.max(...lats)
  const south = Math.min(...lats)
  const east = Math.max(...lngs)
  const west = Math.min(...lngs)

  if (north === south && east === west) {
    return { defaultCenter: { lat: north, lng: east }, defaultZoom: singlePointZoom }
  }
  return { defaultBounds: { north, south, east, west, padding } }
}

/**
 * Connects points chronologically (TABI-1) with per-segment lines colored by
 * the status of the point being traveled to, and colors each marker by its
 * own status — reusing the same 3-state palette everywhere else, never a new
 * color language for the map (CLAUDE.md rule #18).
 */
export function MapTrace({ points }: { points: MapPoint[] }) {
  return (
    <>
      {points.slice(1).map((point, index) => (
        <Polyline
          key={`segment-${index}`}
          path={[points[index], point]}
          strokeColor={mapStatusColor(point.status)}
          strokeOpacity={0.8}
          strokeWeight={3}
        />
      ))}
      {points.map((point, index) => (
        <AdvancedMarker key={`${point.label}-${index}`} position={point} title={point.label}>
          <span
            className="block rounded-full border-2 border-white shadow-sm"
            style={{ width: 14, height: 14, backgroundColor: mapStatusColor(point.status) }}
          />
        </AdvancedMarker>
      ))}
    </>
  )
}
