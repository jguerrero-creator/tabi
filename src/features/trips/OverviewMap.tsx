import { useState } from 'react'
import { APIProvider, Map } from '@vis.gl/react-google-maps'
import type { MapPoint } from '../../components/ui/MiniMap'
import { MapTrace, MiniMap } from '../../components/ui/MiniMap'
import { strings } from '../../lib/strings'

const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

interface OverviewMapProps {
  points: MapPoint[]
}

export function OverviewMap({ points }: OverviewMapProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const canExpand = Boolean(mapsApiKey) && points.length > 0

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
          <APIProvider apiKey={mapsApiKey}>
            <Map defaultCenter={centerOf(points)} defaultZoom={11} gestureHandling="greedy">
              <MapTrace points={points} />
            </Map>
          </APIProvider>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label={strings.common.back}
            className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

function centerOf(points: MapPoint[]) {
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length
  return { lat, lng }
}
