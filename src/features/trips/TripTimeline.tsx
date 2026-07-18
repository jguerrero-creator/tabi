import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ReservationTypeIcon } from '../../components/ui/ReservationTypeIcon'
import { TravelModeIcon } from '../../components/ui/TravelModeIcon'
import { statusDotClasses } from '../../components/menu/statusDotClasses'
import { groupByDate, UNSCHEDULED_KEY } from '../../components/menu/groupByDate'
import { formatDayPillLabel, formatLocalTimeZoneLabel, formatTimeInZone, localTimeZone } from '../../lib/datetime'
import { formatDuration } from '../../lib/duration'
import { computeFreeTimeBlocks, MIN_FREE_SECONDS_TO_SHOW, type FreeTimeBlock } from '../../lib/freeTimeBlocks'
import { strings } from '../../lib/strings'
import type { TravelMode } from '../../lib/travelTime'
import type { Reservation } from '../../types/reservation'
import { DayTabs } from './DayTabs'
import type { TripLeg } from './useTripLegs'

interface TripTimelineProps {
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
export function TripTimeline({ reservations, legs, legsLoading, legsError }: TripTimelineProps) {
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)

  const groups = groupByDate(
    reservations,
    (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
    { unscheduledLabel: strings.planning.unscheduledLabel },
  )

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

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <h2 className="text-base font-medium text-slate-900">{strings.planning.emptyTitle}</h2>
        <p className="text-sm text-slate-500">{strings.planning.emptyBody}</p>
      </div>
    )
  }

  const days = groups.map((group) => ({
    key: group.dateKey,
    label: group.dateKey === UNSCHEDULED_KEY ? group.label : formatDayPillLabel(group.dateKey),
  }))
  const effectiveSelectedKey =
    selectedDayKey && groups.some((group) => group.dateKey === selectedDayKey) ? selectedDayKey : days[0].key
  const selectedGroup = groups.find((group) => group.dateKey === effectiveSelectedKey)!

  const dayTimezone = selectedGroup.items[0]?.start_timezone ?? localTimeZone()
  const anchorInstant = selectedGroup.items[0]?.start_at
  const railEntries = buildRailEntries(selectedGroup.items, freeTimeByFromId)

  return (
    <div className="space-y-4">
      <DayTabs days={days} selectedKey={effectiveSelectedKey} onSelect={setSelectedDayKey} />

      <div className="flex items-center justify-between gap-2">
        {anchorInstant && (
          <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
            {strings.planning.localTimeLabel(formatLocalTimeZoneLabel(anchorInstant, dayTimezone))}
          </p>
        )}
        {dayHasTooLongTravel(selectedGroup.items, freeTimeByFromId) && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {strings.planning.longTravelDay}
          </span>
        )}
      </div>

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
    </div>
  )
}

function buildRailEntries(items: Reservation[], freeTimeByFromId: Map<string, FreeTimeBlock>): RailEntry[] {
  const entries: RailEntry[] = []
  for (const reservation of items) {
    entries.push({ kind: 'reservation', key: reservation.id, time: reservation.start_at, reservation })

    const block = freeTimeByFromId.get(reservation.id)
    if (!block) continue

    if (block.durationSeconds < 0) {
      entries.push({ kind: 'tight', key: `${reservation.id}-tight`, time: block.start, durationSeconds: block.durationSeconds })
      continue
    }

    const showTravel = block.tooLongTravel || block.travelSeconds >= MIN_FREE_SECONDS_TO_SHOW
    const showFree = block.durationSeconds >= MIN_FREE_SECONDS_TO_SHOW
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
    if (showFree) {
      const freeStart = new Date(Date.parse(block.start) + block.travelSeconds * 1000).toISOString()
      entries.push({ kind: 'free', key: `${reservation.id}-free`, time: freeStart, durationSeconds: block.durationSeconds })
    }
  }
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
