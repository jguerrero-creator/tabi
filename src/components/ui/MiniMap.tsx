import { AdvancedMarker, APIProvider, Map, Polyline } from '@vis.gl/react-google-maps'
import { mapStatusColor } from '../../lib/mapStatusColors'
import { strings } from '../../lib/strings'
import type { ReservationStatus } from '../../types/reservation'
import { MapErrorBoundary } from './MapErrorBoundary'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
// AdvancedMarkerElement (TABI-153) requires a Map ID on every <Map>, unlike the
// legacy Marker it replaces. Falls back to Google's DEMO_MAP_ID (dev watermark)
// until a real Map ID is provisioned in Cloud Console — see .env.local.example.
const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || 'DEMO_MAP_ID'

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

  const center = points.length === 2 ? midpoint(points[0], points[1]) : points[0]

  return (
    <div className={`${heightClassName} w-full overflow-hidden rounded-xl border border-slate-200 ${className}`}>
      <MapErrorBoundary heightClassName="h-full" className="rounded-none border-0">
        <APIProvider apiKey={mapsApiKey} libraries={['marker']}>
          <Map
            mapId={mapId}
            defaultCenter={center}
            defaultZoom={points.length === 2 ? 10 : 14}
            gestureHandling="cooperative"
            disableDefaultUI
          >
            <MapTrace points={points} />
          </Map>
        </APIProvider>
      </MapErrorBoundary>
    </div>
  )
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

function midpoint(a: MapPoint, b: MapPoint) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}
