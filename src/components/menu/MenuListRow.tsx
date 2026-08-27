import { Link } from 'react-router-dom'
import { ReservationIcon, reservationTypeBadgeClasses } from '../ui/ReservationTypeIcon'
import { statusDotClasses } from './statusDotClasses'
import { strings } from '../../lib/strings'
import type { ReservationStatus, ReservationType, StaySubtype, TransportSubtype } from '../../types/reservation'

export interface MenuRowFlag {
  label: string
  tone: 'warning' | 'positive'
}

interface MenuListRowProps {
  to: string
  type: ReservationType
  title: string
  status: ReservationStatus
  secondaryLabel?: string | null
  nested?: boolean
  overlapBadge?: string
  flags?: MenuRowFlag[]
  /** TABI-14: the Google rating snapshot taken at bookmark time (TABI-49/TABI-24), if any. */
  rating?: { rating: number; userRatingsTotal: number | null } | null
  staySubtype?: StaySubtype | null
  transportSubtype?: TransportSubtype | null
}

const flagToneClasses: Record<MenuRowFlag['tone'], string> = {
  warning: 'bg-amber-100 text-amber-700',
  positive: 'bg-emerald-100 text-emerald-700',
}

export function MenuListRow({
  to,
  type,
  title,
  status,
  secondaryLabel,
  nested,
  overlapBadge,
  flags,
  rating,
  staySubtype,
  transportSubtype,
}: MenuListRowProps) {
  return (
    <li>
      <Link
        to={to}
        className={`flex items-center gap-3 py-3 hover:bg-slate-50 ${nested ? 'pl-10 pr-4 bg-slate-50/60' : 'px-4'}`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${reservationTypeBadgeClasses[type]}`}
        >
          <ReservationIcon
            reservation={{ type, stay_subtype: staySubtype, transport_subtype: transportSubtype }}
            className="h-4 w-4"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClasses[status]}`} />
            <span className="truncate">{title}</span>
          </p>
          {secondaryLabel && <p className="text-xs text-slate-500">{secondaryLabel}</p>}
          {overlapBadge && <p className="text-[11px] text-slate-400">{overlapBadge}</p>}
          {((flags && flags.length > 0) || rating) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {rating && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  {strings.activityPlaceSearch.ratingLabel(rating.rating, rating.userRatingsTotal ?? 0)}
                </span>
              )}
              {flags?.map((flag) => (
                <span
                  key={flag.label}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${flagToneClasses[flag.tone]}`}
                >
                  {flag.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>
    </li>
  )
}
