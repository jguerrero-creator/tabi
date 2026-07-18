import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { groupByDate } from '../../components/menu/groupByDate'
import { formatTimeInZone } from '../../lib/datetime'
import { strings } from '../../lib/strings'
import type { Reservation } from '../../types/reservation'

interface TripTimelineProps {
  reservations: Reservation[]
}

/**
 * Orders a trip's reservations chronologically and groups them by local day
 * (TABI-31). Reservations with no start date ("decide later") fall into a
 * trailing "Unscheduled" group rather than being hidden.
 */
export function TripTimeline({ reservations }: TripTimelineProps) {
  const groups = groupByDate(
    reservations,
    (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
    { unscheduledLabel: strings.planning.unscheduledLabel },
  )

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <h2 className="text-base font-medium text-slate-900">{strings.planning.emptyTitle}</h2>
        <p className="text-sm text-slate-500">{strings.planning.emptyBody}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <MenuSection key={group.dateKey} label={group.label}>
          {group.items.map((reservation) => (
            <MenuListRow
              key={reservation.id}
              to={`/reservations/${reservation.id}`}
              type={reservation.type}
              title={reservation.name}
              status={reservation.status}
              secondaryLabel={rowLabel(reservation)}
            />
          ))}
        </MenuSection>
      ))}
    </div>
  )
}

function rowLabel(reservation: Reservation): string | null {
  if (!reservation.start_at) return null
  const startLabel = strings.reservationLegLabels[reservation.type].start
  return `${startLabel} · ${formatTimeInZone(reservation.start_at, reservation.start_timezone)}`
}
