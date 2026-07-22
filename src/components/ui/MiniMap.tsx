import { APIProvider, Map, Marker, Polyline } from '@vis.gl/react-google-maps'
import { mapStatusColor } from '../../lib/mapStatusColors'
import { strings } from '../../lib/strings'
import type { ReservationStatus } from '../../types/reservation'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

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
}

export function MiniMap({ points, className = '' }: MiniMapProps) {
  if (!mapsApiKey || points.length === 0) {
    return (
      <div
        className={`flex h-40 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-400 ${className}`}
      >
        {strings.reservationDetail.mapUnavailable}
      </div>
    )
  }

  const center = points.length === 2 ? midpoint(points[0], points[1]) : points[0]

  return (
    <div className={`h-40 w-full overflow-hidden rounded-xl border border-slate-200 ${className}`}>
      <APIProvider apiKey={mapsApiKey}>
        <Map
          defaultCenter={center}
          defaultZoom={points.length === 2 ? 10 : 14}
          gestureHandling="cooperative"
          disableDefaultUI
        >
          <MapTrace points={points} />
        </Map>
      </APIProvider>
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
        <Marker
          key={`${point.label}-${index}`}
          position={point}
          title={point.label}
          icon={markerIcon(point.status)}
        />
      ))}
    </>
  )
}

function markerIcon(status: ReservationStatus | null): google.maps.Symbol | undefined {
  if (typeof google === 'undefined') return undefined
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: mapStatusColor(status),
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 7,
  }
}

function midpoint(a: MapPoint, b: MapPoint) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}
