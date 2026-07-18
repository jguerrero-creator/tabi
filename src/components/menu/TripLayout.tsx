import { Outlet, useParams } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function TripLayout() {
  const { tripId } = useParams<{ tripId: string }>()

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 pb-24">
      <Outlet />
      {tripId && <BottomNav tripId={tripId} />}
    </div>
  )
}
