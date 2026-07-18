import { FreeTimeRow } from '../../components/menu/FreeTimeRow'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { groupByDate } from '../../components/menu/groupByDate'
import { formatTimeInZone } from '../../lib/datetime'
import { computeFreeTimeBlocks, type FreeTimeBlock } from '../../lib/freeTimeBlocks'
import { legKey } from '../../lib/tripLegs'
import { strings } from '../../lib/strings'
import type { Reservation } from '../../types/reservation'
import type { TripLeg } from './useTripLegs'

interface TripTimelineProps {
  reservations: Reservation[]
  legs: TripLeg[]
  /** While legs are (re-)loading, gaps are shown without a free-time verdict rather than guessing zero travel time. */
  legsLoading: boolean
}

/**
 * Orders a trip's reservations chronologically and groups them by local day
 * (TABI-31), interleaving each day's free-time blocks between the
 * reservations they fall between (TABI-4).
 */
export function TripTimeline({ reservations, legs, legsLoading }: TripTimelineProps) {
  const groups = groupByDate(
    reservations,
    (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
    { unscheduledLabel: strings.planning.unscheduledLabel },
  )

  const freeTimeByPair = new Map<string, FreeTimeBlock>(
    legsLoading
      ? []
      : computeFreeTimeBlocks(reservations, legs).map((block) => [
          legKey(block.fromReservationId, block.toReservationId),
          block,
        ]),
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
          {group.items.flatMap((reservation, index) => {
            const rows = [
              <MenuListRow
                key={reservation.id}
                to={`/reservations/${reservation.id}`}
                type={reservation.type}
                title={reservation.name}
                status={reservation.status}
                secondaryLabel={rowLabel(reservation)}
              />,
            ]
            const next = group.items[index + 1]
            const block = next ? freeTimeByPair.get(legKey(reservation.id, next.id)) : undefined
            if (block) {
              rows.push(<FreeTimeRow key={`${reservation.id}-free`} durationSeconds={block.durationSeconds} />)
            }
            return rows
          })}
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
