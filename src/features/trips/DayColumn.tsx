import { Link } from 'react-router-dom'
import { ReservationTypeIcon } from '../../components/ui/ReservationTypeIcon'
import { TravelModeIcon } from '../../components/ui/TravelModeIcon'
import { statusDotClasses } from '../../components/menu/statusDotClasses'
import { formatLocalTimeZoneLabel, formatTimeInZone, localTimeZone } from '../../lib/datetime'
import { formatDuration } from '../../lib/duration'
import {
  MIN_FREE_SECONDS_TO_SHOW,
  type DayEdgeFreeBlock,
  type FreeTimeBlock,
} from '../../lib/freeTimeBlocks'
import { strings } from '../../lib/strings'
import type { TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'
import type { TripDayLocation } from '../../types/dayLocation'
import { DayPlannedLocation } from './DayPlannedLocation'
import type { DayLocationInput } from './useTripDayLocations'

type RailEntry =
  | { kind: 'reservation'; key: string; time: string | null; timezone: string | null; reservation: Reservation }
  | {
      kind: 'travel'
      key: string
      time: string
      timezone: string | null
      durationSeconds: number
      tooLongTravel: boolean
      mode: TravelMode
    }
  | { kind: 'free'; key: string; time: string; timezone: string | null; durationSeconds: number }
  | { kind: 'tight'; key: string; time: string; timezone: string | null; durationSeconds: number }

interface DayColumnProps {
  dayKey: string
  /** Only passed by the desktop carousel (TABI-149) — mobile relies on DayTabs to convey day identity instead. */
  label?: string
  items: Reservation[]
  freeTimeByFromId: Map<string, FreeTimeBlock>
  edges: { leading?: DayEdgeFreeBlock; trailing?: DayEdgeFreeBlock; fullDay?: DayEdgeFreeBlock }
  /**
   * Planned-location widget (TABI-114) is omitted entirely for the
   * "Unscheduled" pseudo-day (no calendar date to attach a location to) —
   * the parent only passes these when `dayKey` is a real date.
   */
  dayLocation?: TripDayLocation | null
  onSaveDayLocation?: (input: DayLocationInput) => Promise<void>
  onClearDayLocation?: () => Promise<void>
  className?: string
}

/** Renders one day's rail of reservations/travel/free-time entries — shared by mobile's single-day view and desktop's multi-column carousel. */
export function DayColumn({
  dayKey,
  label,
  items,
  freeTimeByFromId,
  edges,
  dayLocation,
  onSaveDayLocation,
  onClearDayLocation,
  className,
}: DayColumnProps) {
  const dayTimezone = items[0]?.start_timezone ?? localTimeZone()
  const anchorInstant = items[0]?.start_at

  const railEntries =
    items.length === 0 && edges.fullDay
      ? [
          {
            kind: 'free' as const,
            key: 'day-full',
            time: edges.fullDay.start,
            timezone: dayTimezone,
            durationSeconds: edges.fullDay.durationSeconds,
          },
        ]
      : buildRailEntries(items, freeTimeByFromId, edges)

  return (
    <div className={`space-y-4 ${className ?? ''}`}>
      {label && <h3 className="text-sm font-semibold text-slate-900">{label}</h3>}

      <div className="flex items-center justify-between gap-2">
        {anchorInstant && (
          <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
            {strings.planning.localTimeLabel(formatLocalTimeZoneLabel(anchorInstant, dayTimezone))}
          </p>
        )}
        {dayHasTooLongTravel(items, freeTimeByFromId) && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {strings.planning.longTravelDay}
          </span>
        )}
      </div>

      {onSaveDayLocation && onClearDayLocation && (
        <DayPlannedLocation
          dayKey={dayKey}
          location={dayLocation ?? null}
          onSave={onSaveDayLocation}
          onClear={onClearDayLocation}
        />
      )}

      {railEntries.length === 0 ? (
        <p className="ml-14 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          {strings.planning.dayEmptyBody}
        </p>
      ) : (
        <ul className="ml-14 space-y-4 border-l-2 border-slate-200 pl-4">
          {railEntries.map((entry) => (
            <li key={entry.key} className="relative">
              <span className="absolute -left-[4.75rem] top-2 w-14 text-right text-xs font-medium text-slate-500">
                {entry.time ? formatTimeInZone(entry.time, entry.timezone ?? dayTimezone) : ''}
              </span>
              <span className="absolute -left-[1.4rem] top-2 h-3 w-3 rounded-full border-2 border-white bg-slate-400 ring-1 ring-slate-300" />
              {renderEntry(entry)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Threads reservations, travel legs, and free time into a single ordered
 * rail. Free time between two same-day reservations still comes from the
 * whole-trip pairwise `FreeTimeBlock`s (unaffected by day bounds — both ends
 * are known). The day's own edges (before the first reservation, after the
 * last) come from `dayEdges` instead (TABI-4): the pairwise block trailing
 * the day's last reservation may run into a reservation days away, which
 * would overstate "free time" past the day's own end, so it's replaced by
 * the day-bounded trailing edge rather than shown alongside it.
 */
function buildRailEntries(
  items: Reservation[],
  freeTimeByFromId: Map<string, FreeTimeBlock>,
  dayEdges: { leading?: DayEdgeFreeBlock; trailing?: DayEdgeFreeBlock },
): RailEntry[] {
  const entries: RailEntry[] = []

  if (dayEdges.leading) {
    entries.push({
      kind: 'free',
      key: 'day-leading',
      time: dayEdges.leading.start,
      timezone: items[0]?.start_timezone ?? null,
      durationSeconds: dayEdges.leading.durationSeconds,
    })
  }

  items.forEach((reservation, index) => {
    // Origin-side timezone: where this reservation actually is when it ends
    // (or, if it never got an end leg, wherever it started) — the timezone a
    // departure right after it would be measured in.
    const originTimezone = reservation.end_timezone ?? reservation.start_timezone

    entries.push({
      kind: 'reservation',
      key: reservation.id,
      time: reservation.start_at,
      timezone: reservation.start_timezone,
      reservation,
    })

    const isLastOfDay = index === items.length - 1
    // Destination-side timezone: the next chronological reservation's own
    // location — `items` arrives pre-sorted by start_at (server-side query),
    // so items[index + 1] is reliably "where this leg arrives."
    const destinationTimezone = items[index + 1]?.start_timezone ?? originTimezone
    // A day's last reservation has no pairwise block at all when it's also
    // the trip's very last scheduled reservation — the trailing edge must
    // still show in that case, so it's handled outside the `block` guard.
    const block = freeTimeByFromId.get(reservation.id)

    if (block && block.durationSeconds < 0) {
      entries.push({
        kind: 'tight',
        key: `${reservation.id}-tight`,
        time: block.start,
        timezone: originTimezone,
        durationSeconds: block.durationSeconds,
      })
      return
    }

    if (block) {
      const showTravel = block.tooLongTravel || block.travelSeconds >= MIN_FREE_SECONDS_TO_SHOW
      if (showTravel) {
        entries.push({
          kind: 'travel',
          key: `${reservation.id}-travel`,
          time: block.start,
          timezone: originTimezone,
          durationSeconds: block.travelSeconds,
          tooLongTravel: block.tooLongTravel,
          mode: block.mode,
        })
      }
    }

    if (isLastOfDay) {
      if (dayEdges.trailing) {
        entries.push({
          kind: 'free',
          key: `${reservation.id}-free`,
          time: dayEdges.trailing.start,
          timezone: originTimezone,
          durationSeconds: dayEdges.trailing.durationSeconds,
        })
      }
      return
    }

    if (block && block.durationSeconds >= MIN_FREE_SECONDS_TO_SHOW) {
      const freeStart = new Date(Date.parse(block.start) + block.travelSeconds * 1000).toISOString()
      entries.push({
        kind: 'free',
        key: `${reservation.id}-free`,
        time: freeStart,
        timezone: destinationTimezone,
        durationSeconds: block.durationSeconds,
      })
    }
  })

  return entries
}

function renderEntry(entry: RailEntry) {
  switch (entry.kind) {
    case 'reservation':
      return <ReservationCard reservation={entry.reservation} />
    case 'tight':
      return (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {strings.planning.tightConnection(formatDuration(Math.abs(entry.durationSeconds)))}
        </p>
      )
    case 'travel':
      return (
        <p
          className={`flex items-center gap-1.5 rounded-xl px-4 py-3 text-sm font-medium ${
            entry.tooLongTravel
              ? 'bg-amber-50 text-amber-700'
              : 'bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)] text-slate-600'
          }`}
        >
          <TravelModeIcon mode={entry.mode} className="h-4 w-4 shrink-0" />
          {entry.tooLongTravel
            ? strings.planning.longTravel(formatDuration(entry.durationSeconds), entry.mode)
            : strings.planning.travelTime(formatDuration(entry.durationSeconds), entry.mode)}
        </p>
      )
    case 'free':
      return (
        <p className="rounded-xl border-2 border-dashed border-teal-200 bg-white px-4 py-3 text-sm font-medium text-teal-700">
          {strings.planning.freeTime(formatDuration(entry.durationSeconds))}
        </p>
      )
  }
}

function ReservationCard({ reservation }: { reservation: Reservation }) {
  return (
    <Link
      to={`/reservations/${reservation.id}`}
      className="flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 hover:bg-slate-200"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-teal-600">
        <ReservationTypeIcon type={reservation.type} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClasses[reservation.status]}`} />
          <span className="truncate">{reservation.name}</span>
        </p>
        {rowLabel(reservation) && <p className="truncate text-xs text-slate-500">{rowLabel(reservation)}</p>}
      </div>
    </Link>
  )
}

/** A day is flagged as a long-travel day (TABI-6) if any leg starting within it meets the too-long threshold. */
function dayHasTooLongTravel(items: Reservation[], freeTimeByFromId: Map<string, FreeTimeBlock>): boolean {
  return items.some((item) => freeTimeByFromId.get(item.id)?.tooLongTravel ?? false)
}

function rowLabel(reservation: Reservation): string | null {
  if (!reservation.start_at) return null
  const startLabel = strings.reservationLegLabels[reservation.type].start
  return `${startLabel} · ${formatTimeInZone(reservation.start_at, reservation.start_timezone)}`
}
