import { Link } from 'react-router-dom'
import { ReservationTypeIcon } from '../../components/ui/ReservationTypeIcon'
import { TravelModeIcon } from '../../components/ui/TravelModeIcon'
import { statusDotClasses } from '../../components/menu/statusDotClasses'
import { groupByDate, UNSCHEDULED_KEY, type DateGroup } from '../../components/menu/groupByDate'
import { formatDayPillLabel, formatLocalTimeZoneLabel, formatTimeInZone, localTimeZone } from '../../lib/datetime'
import { formatDuration } from '../../lib/duration'
import {
  computeDayEdgeFreeBlocks,
  computeFreeTimeBlocks,
  MIN_FREE_SECONDS_TO_SHOW,
  type DayEdgeFreeBlock,
  type FreeTimeBlock,
} from '../../lib/freeTimeBlocks'
import { strings } from '../../lib/strings'
import type { TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'
import type { Trip } from '../../types/trip'
import { DayTabs } from './DayTabs'
import type { TripLeg } from './useTripLegs'

interface TripTimelineProps {
  trip: Trip | null
  reservations: Reservation[]
  legs: TripLeg[]
  /**
   * While legs are (re-)loading, or failed to load entirely, gaps are shown
   * without a free-time verdict rather than guessing zero travel time — an
   * empty `legs` array here means "no travel-time data", not "no travel
   * needed", and those must not be conflated.
   */
  legsLoading: boolean
  legsError: string | null
  /**
   * Controlled by the parent (URL search param) rather than owned locally
   * (TABI-131) — so leaving Planning for a reservation's detail screen and
   * pressing back restores the same day instead of resetting to the first.
   */
  selectedDayKey: string | null
  onSelectDay: (key: string) => void
}

type RailEntry =
  | { kind: 'reservation'; key: string; time: string | null; reservation: Reservation }
  | { kind: 'travel'; key: string; time: string; durationSeconds: number; tooLongTravel: boolean; mode: TravelMode }
  | { kind: 'free'; key: string; time: string; durationSeconds: number }
  | { kind: 'tight'; key: string; time: string; durationSeconds: number }

/**
 * Orders a trip's reservations chronologically and groups them by local day
 * (TABI-31), one day selected at a time via day-tab pills, with each day's
 * free-time/travel blocks threaded into a single vertical rail (TABI-13/TABI-3/TABI-4).
 */
export function TripTimeline({
  trip,
  reservations,
  legs,
  legsLoading,
  legsError,
  selectedDayKey,
  onSelectDay,
}: TripTimelineProps) {
  const groups = groupByDate(
    reservations,
    (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
    { unscheduledLabel: strings.planning.unscheduledLabel },
  )
  const groupsByKey = new Map(groups.map((group) => [group.dateKey, group]))

  // Keyed by fromReservationId, not by (from, to) pair: a gap is rendered right
  // after the reservation it follows regardless of which day-group that
  // reservation's chronological successor happens to start in — a day-grouped
  // list otherwise silently drops any gap that crosses a day boundary (e.g. a
  // multi-night Stay's checkout followed by a Transport that starts a later day).
  const freeTimeByFromId = new Map<string, FreeTimeBlock>(
    legsLoading || legsError
      ? []
      : computeFreeTimeBlocks(reservations, legs).map((block) => [block.fromReservationId, block]),
  )

  const days = buildDayTabs(trip, groups)

  if (days.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <h2 className="text-base font-medium text-slate-900">{strings.planning.emptyTitle}</h2>
        <p className="text-sm text-slate-500">{strings.planning.emptyBody}</p>
      </div>
    )
  }

  const effectiveSelectedKey =
    selectedDayKey && days.some((day) => day.key === selectedDayKey) ? selectedDayKey : days[0].key
  const selectedItems = groupsByKey.get(effectiveSelectedKey)?.items ?? []

  const dayTimezone = selectedItems[0]?.start_timezone ?? localTimeZone()
  const anchorInstant = selectedItems[0]?.start_at

  // The "Unscheduled" pill has no calendar date to bound a day range with,
  // so day-edge free blocks (TABI-4) only apply to real date tabs.
  const dayEdges =
    trip && effectiveSelectedKey !== UNSCHEDULED_KEY
      ? computeDayEdgeFreeBlocks(
          [
            {
              dateKey: effectiveSelectedKey,
              timezone: dayTimezone,
              items: selectedItems.filter(
                (item): item is Reservation & { start_at: string } => item.start_at !== null,
              ),
            },
          ],
          trip.day_start_time,
          trip.day_end_time,
        )
      : []
  const leadingEdge = dayEdges.find((block) => block.position === 'leading')
  const trailingEdge = dayEdges.find((block) => block.position === 'trailing')
  const fullDayEdge = dayEdges.find((block) => block.position === 'full-day')

  const railEntries =
    selectedItems.length === 0 && fullDayEdge
      ? [{ kind: 'free' as const, key: 'day-full', time: fullDayEdge.start, durationSeconds: fullDayEdge.durationSeconds }]
      : buildRailEntries(selectedItems, freeTimeByFromId, { leading: leadingEdge, trailing: trailingEdge })

  return (
    <div className="space-y-4">
      <DayTabs days={days} selectedKey={effectiveSelectedKey} onSelect={onSelectDay} />

      <div className="flex items-center justify-between gap-2">
        {anchorInstant && (
          <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
            {strings.planning.localTimeLabel(formatLocalTimeZoneLabel(anchorInstant, dayTimezone))}
          </p>
        )}
        {dayHasTooLongTravel(selectedItems, freeTimeByFromId) && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {strings.planning.longTravelDay}
          </span>
        )}
      </div>

      {railEntries.length === 0 ? (
        <p className="ml-14 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          {strings.planning.dayEmptyBody}
        </p>
      ) : (
        <ul className="ml-14 space-y-4 border-l-2 border-slate-200 pl-4">
          {railEntries.map((entry) => (
            <li key={entry.key} className="relative">
              <span className="absolute -left-[4.75rem] top-2 w-14 text-right text-xs font-medium text-slate-500">
                {entry.time ? formatTimeInZone(entry.time, dayTimezone) : ''}
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
 * Day-tab pills must cover the whole trip (start_date → end_date), not just
 * the days that already have a reservation (TABI-139) — otherwise a day with
 * nothing booked yet is invisible instead of surfaced as free/unplanned.
 * Reservation dates outside the trip's own range are still included
 * defensively (e.g. a trip edited after items were added), and the
 * "Unscheduled" pill is only shown when it's actually got items.
 */
function buildDayTabs(trip: Trip | null, groups: DateGroup<Reservation>[]): { key: string; label: string }[] {
  const rangeKeys = tripDateRangeKeys(trip?.start_date ?? null, trip?.end_date ?? null)
  const scheduledGroupKeys = groups.map((group) => group.dateKey).filter((key) => key !== UNSCHEDULED_KEY)
  const dateKeys = Array.from(new Set([...rangeKeys, ...scheduledGroupKeys])).sort()

  const days = dateKeys.map((key) => ({ key, label: formatDayPillLabel(key) }))

  const unscheduledGroup = groups.find((group) => group.dateKey === UNSCHEDULED_KEY)
  if (unscheduledGroup) {
    days.push({ key: unscheduledGroup.dateKey, label: unscheduledGroup.label })
  }

  return days
}

/** Trip `start_date`/`end_date` are plain calendar dates; anchor to UTC midnight per day, same reasoning as `formatTripDateRange`. */
function tripDateRangeKeys(startDate: string | null, endDate: string | null): string[] {
  if (!startDate || !endDate) return []

  const keys: string[] = []
  const start = Date.UTC(...dateParts(startDate))
  const end = Date.UTC(...dateParts(endDate))
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    keys.push(new Date(t).toISOString().slice(0, 10))
  }
  return keys
}

function dateParts(dateStr: string): [number, number, number] {
  const [year, month, day] = dateStr.split('-').map(Number)
  return [year, month - 1, day]
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
      durationSeconds: dayEdges.leading.durationSeconds,
    })
  }

  items.forEach((reservation, index) => {
    entries.push({ kind: 'reservation', key: reservation.id, time: reservation.start_at, reservation })

    const isLastOfDay = index === items.length - 1
    // A day's last reservation has no pairwise block at all when it's also
    // the trip's very last scheduled reservation — the trailing edge must
    // still show in that case, so it's handled outside the `block` guard.
    const block = freeTimeByFromId.get(reservation.id)

    if (block && block.durationSeconds < 0) {
      entries.push({ kind: 'tight', key: `${reservation.id}-tight`, time: block.start, durationSeconds: block.durationSeconds })
      return
    }

    if (block) {
      const showTravel = block.tooLongTravel || block.travelSeconds >= MIN_FREE_SECONDS_TO_SHOW
      if (showTravel) {
        entries.push({
          kind: 'travel',
          key: `${reservation.id}-travel`,
          time: block.start,
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
          durationSeconds: dayEdges.trailing.durationSeconds,
        })
      }
      return
    }

    if (block && block.durationSeconds >= MIN_FREE_SECONDS_TO_SHOW) {
      const freeStart = new Date(Date.parse(block.start) + block.travelSeconds * 1000).toISOString()
      entries.push({ kind: 'free', key: `${reservation.id}-free`, time: freeStart, durationSeconds: block.durationSeconds })
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
