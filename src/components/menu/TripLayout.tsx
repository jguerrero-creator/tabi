import { Outlet, useParams } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { DesktopSidebar } from './DesktopSidebar'

export function TripLayout() {
  const { tripId } = useParams<{ tripId: string }>()

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {tripId && <DesktopSidebar tripId={tripId} />}
      <div className="mx-auto w-full max-w-lg pb-24 lg:mx-0 lg:max-w-none lg:flex-1 lg:pb-0">
        <Outlet />
      </div>
      {tripId && <BottomNav tripId={tripId} />}
    </div>
  )
}
