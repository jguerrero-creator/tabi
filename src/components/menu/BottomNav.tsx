import { Link, useLocation } from 'react-router-dom'
import { strings } from '../../lib/strings'
import { ReservationTypeIcon } from '../ui/ReservationTypeIcon'
import { tripNavTabs } from './tripNavTabs'

interface BottomNavProps {
  tripId: string
}

export function BottomNav({ tripId }: BottomNavProps) {
  const { pathname } = useLocation()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-lg border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="flex">
        {tripNavTabs.map(({ tab, label, path }) => {
          const to = path(tripId)
          const active = tab === 'overview' ? pathname === to : pathname.startsWith(to)
          return (
            <Link
              key={tab}
              to={to}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                active ? 'text-teal-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'overview' ? (
                <OverviewIcon className="h-5 w-5" />
              ) : (
                <ReservationTypeIcon type={tab} className="h-5 w-5" />
              )}
              {label}
            </Link>
          )
        })}
        <span
          title={strings.common.comingSoon}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-300"
        >
          <BudgetIcon className="h-5 w-5" />
          {strings.menus.budget}
        </span>
      </div>
    </nav>
  )
}

export function OverviewIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" />
      <path d="M9 3v15" />
      <path d="M15 6v15" />
    </svg>
  )
}

export function BudgetIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <circle cx="16" cy="15" r="1.5" />
    </svg>
  )
}
