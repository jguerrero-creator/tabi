import { Link, useLocation } from 'react-router-dom'
import { useTrip } from '../../features/trips/useTrip'
import { formatTripDateRange } from '../../lib/datetime'
import { strings } from '../../lib/strings'
import { ReservationTypeIcon } from '../ui/ReservationTypeIcon'
import { BudgetIcon, OverviewIcon, SouvenirsIcon } from './BottomNav'
import { tripNavTabs } from './tripNavTabs'

interface DesktopSidebarProps {
  tripId: string
}

/**
 * Persistent desktop nav (TABI-149) — self-hides via `lg:flex` rather than a
 * viewport check, and derives all active state from the URL rather than
 * OverviewScreen's local state, so it can drive the Overview/Planning pill
 * (`?tab=planning`, TABI-131) from any trip screen, not just the Overview route.
 */
export function DesktopSidebar({ tripId }: DesktopSidebarProps) {
  const { trip } = useTrip(tripId)
  const { pathname, search } = useLocation()

  const overviewPath = `/trips/${tripId}`
  const isOnOverviewRoute = pathname === overviewPath
  const isPlanningTab = new URLSearchParams(search).get('tab') === 'planning'

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex">
      <div className="mb-6 min-w-0">
        <h1 className="truncate text-lg font-semibold text-slate-900">{trip?.name ?? strings.overview.title}</h1>
        {trip && formatTripDateRange(trip.start_date, trip.end_date) && (
          <p className="truncate text-xs text-slate-500">{formatTripDateRange(trip.start_date, trip.end_date)}</p>
        )}
      </div>

      <div className="mb-6 flex rounded-full border border-slate-200 bg-slate-50 p-1">
        <Link
          to={overviewPath}
          className={`flex-1 rounded-full px-3 py-1.5 text-center text-sm font-medium transition-colors ${
            isOnOverviewRoute && !isPlanningTab ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-white'
          }`}
        >
          {strings.overview.overviewTab}
        </Link>
        <Link
          to={`${overviewPath}?tab=planning`}
          className={`flex-1 rounded-full px-3 py-1.5 text-center text-sm font-medium transition-colors ${
            isOnOverviewRoute && isPlanningTab ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-white'
          }`}
        >
          {strings.overview.planningTab}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {tripNavTabs.map(({ tab, label, path }) => {
          const to = path(tripId)
          const active = tab === 'overview' ? pathname === to : pathname.startsWith(to)
          return (
            <Link
              key={tab}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                active ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab === 'overview' ? (
                <OverviewIcon className="h-5 w-5" />
              ) : tab === 'budget' ? (
                <BudgetIcon className="h-5 w-5" />
              ) : tab === 'souvenirs' ? (
                <SouvenirsIcon className="h-5 w-5" />
              ) : (
                <ReservationTypeIcon type={tab} className="h-5 w-5" />
              )}
              {label}
            </Link>
          )
        })}
      </nav>

      <Link to="/" className="mt-6 text-sm font-medium text-slate-500 hover:text-slate-700">
        ← {strings.sidebar.allTrips}
      </Link>
    </aside>
  )
}
