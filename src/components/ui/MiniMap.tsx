import { APIProvider, Map, Marker } from '@vis.gl/react-google-maps'
import { strings } from '../../lib/strings'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export interface MapPoint {
  lat: number
  lng: number
  label: string
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
          {points.map((point) => (
            <Marker key={point.label} position={point} title={point.label} />
          ))}
        </Map>
      </APIProvider>
    </div>
  )
}

function midpoint(a: MapPoint, b: MapPoint) {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
}
