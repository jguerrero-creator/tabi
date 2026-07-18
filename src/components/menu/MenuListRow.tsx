import { Link } from 'react-router-dom'
import { ReservationTypeIcon } from '../ui/ReservationTypeIcon'
import { statusDotClasses } from './statusDotClasses'
import type { ReservationStatus, ReservationType } from '../../types/reservation'

interface MenuListRowProps {
  to: string
  type: ReservationType
  title: string
  status: ReservationStatus
  secondaryLabel?: string | null
}

export function MenuListRow({ to, type, title, status, secondaryLabel }: MenuListRowProps) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
          <ReservationTypeIcon type={type} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClasses[status]}`} />
            <span className="truncate">{title}</span>
          </p>
          {secondaryLabel && <p className="text-xs text-slate-500">{secondaryLabel}</p>}
        </div>
      </Link>
    </li>
  )
}
