import { groupByDate, UNSCHEDULED_KEY, type DateGroup } from '../../components/menu/groupByDate'
import { formatDayPillLabel, localTimeZone } from '../../lib/datetime'
import {
  computeDayEdgeFreeBlocks,
  computeFreeTimeBlocks,
  type DayEdgeFreeBlock,
  type FreeTimeBlock,
} from '../../lib/freeTimeBlocks'
import { strings } from '../../lib/strings'
import { findActiveStay } from '../stay/computeAccommodationGaps'
import { findActiveVehicleRental } from '../transport/findActiveVehicleRental'
import type { Reservation } from '../../types/reservation'
import type { Trip } from '../../types/trip'
import type { TripDayLocation } from '../../types/dayLocation'
import type { TripDayNote } from '../../types/dayNote'
import { DayColumn } from './DayColumn'
import { DayTabs, type DayTab } from './DayTabs'
import type { TripLeg } from './useTripLegs'
import type { DayLocationInput } from './useTripDayLocations'

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
   * Only exercised by the mobile single-day view — the desktop carousel
   * (TABI-149) shows every day at once, so it has no selection to restore.
   */
  selectedDayKey: string | null
  onSelectDay: (key: string) => void
  /** Planned locations (TABI-114), keyed by date — absent for the "Unscheduled" pseudo-day. */
  dayLocationsByKey: Map<string, TripDayLocation>
  onSaveDayLocation: (dateKey: string, input: DayLocationInput) => Promise<void>
  onClearDayLocation: (dateKey: string) => Promise<void>
  /** Day notes (TABI-56), keyed by date — absent for the "Unscheduled" pseudo-day. */
  dayNotesByKey: Map<string, TripDayNote>
  onSaveDayNote: (dateKey: string, note: string) => Promise<void>
  onClearDayNote: (dateKey: string) => Promise<void>
  /** Opens the quick-add sheet from a free-time block on the rail (TABI-54). */
  onAddAtFreeBlock?: (input: { startAt: string; timezone: string | null }) => void
}

type DayEdges = { leading?: DayEdgeFreeBlock; trailing?: DayEdgeFreeBlock; fullDay?: DayEdgeFreeBlock }

/**
 * Orders a trip's reservations chronologically and groups them by local day
 * (TABI-31). Mobile shows one day at a time via day-tab pills; desktop shows
 * every day as a horizontally-scrollable row of columns (TABI-149) — both
 * render paths share the same per-day rail data (`groupsByKey`,
 * `freeTimeByFromId`, `dayEdgesByKey`), computed once for every day rather
 * than only the selected one.
 */
export function TripTimeline({
  trip,
  reservations,
  legs,
  legsLoading,
  legsError,
  selectedDayKey,
  onSelectDay,
  dayLocationsByKey,
  onSaveDayLocation,
  onClearDayLocation,
  dayNotesByKey,
  onSaveDayNote,
  onClearDayNote,
  onAddAtFreeBlock,
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

  const days = buildDayTabs(trip, groups, groupsByKey, reservations)

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

  const dayEdgesByKey = trip ? buildDayEdgesByKey(trip, days, groupsByKey) : new Map<string, DayEdges>()

  return (
    <>
      <div className="space-y-4 lg:hidden">
        <DayTabs days={days} selectedKey={effectiveSelectedKey} onSelect={onSelectDay} />
        <DayColumn
          dayKey={effectiveSelectedKey}
          items={groupsByKey.get(effectiveSelectedKey)?.items ?? []}
          freeTimeByFromId={freeTimeByFromId}
          edges={dayEdgesByKey.get(effectiveSelectedKey) ?? {}}
          activeStay={
            effectiveSelectedKey === UNSCHEDULED_KEY ? null : findActiveStay(effectiveSelectedKey, reservations)
          }
          dayLocation={dayLocationsByKey.get(effectiveSelectedKey)}
          onAddAtFreeBlock={onAddAtFreeBlock}
          onSaveDayLocation={
            effectiveSelectedKey === UNSCHEDULED_KEY
              ? undefined
              : (input) => onSaveDayLocation(effectiveSelectedKey, input)
          }
          onClearDayLocation={
            effectiveSelectedKey === UNSCHEDULED_KEY ? undefined : () => onClearDayLocation(effectiveSelectedKey)
          }
          dayNote={dayNotesByKey.get(effectiveSelectedKey)}
          onSaveDayNote={
            effectiveSelectedKey === UNSCHEDULED_KEY
              ? undefined
              : (note) => onSaveDayNote(effectiveSelectedKey, note)
          }
          onClearDayNote={
            effectiveSelectedKey === UNSCHEDULED_KEY ? undefined : () => onClearDayNote(effectiveSelectedKey)
          }
        />
      </div>

      <div className="hidden gap-4 overflow-x-auto pb-4 lg:flex lg:snap-x lg:snap-mandatory">
        {days.map((day) => (
          <DayColumn
            key={day.key}
            dayKey={day.key}
            label={day.label}
            items={groupsByKey.get(day.key)?.items ?? []}
            freeTimeByFromId={freeTimeByFromId}
            edges={dayEdgesByKey.get(day.key) ?? {}}
            activeStay={day.key === UNSCHEDULED_KEY ? null : findActiveStay(day.key, reservations)}
            dayLocation={dayLocationsByKey.get(day.key)}
            onAddAtFreeBlock={onAddAtFreeBlock}
            onSaveDayLocation={
              day.key === UNSCHEDULED_KEY ? undefined : (input) => onSaveDayLocation(day.key, input)
            }
            onClearDayLocation={day.key === UNSCHEDULED_KEY ? undefined : () => onClearDayLocation(day.key)}
            dayNote={dayNotesByKey.get(day.key)}
            onSaveDayNote={day.key === UNSCHEDULED_KEY ? undefined : (note) => onSaveDayNote(day.key, note)}
            onClearDayNote={day.key === UNSCHEDULED_KEY ? undefined : () => onClearDayNote(day.key)}
            className="w-80 shrink-0 snap-start"
          />
        ))}
      </div>
    </>
  )
}

/**
 * Day-tab pills must cover the whole trip (start_date → end_date), not just
 * the days that already have a reservation (TABI-139) — otherwise a day with
 * nothing booked yet is invisible instead of surfaced as free/unplanned.
 * Reservation dates outside the trip's own range are still included
 * defensively (e.g. a trip edited after items were added), and the
 * "Unscheduled" pill is only shown when it's actually got items.
 *
 * Each pill also carries the day's accommodation status, at-disposal vehicle
 * rental status, and total item count (TABI-143), computed here once for
 * every day rather than re-derived per pill.
 */
function buildDayTabs(
  trip: Trip | null,
  groups: DateGroup<Reservation>[],
  groupsByKey: Map<string, DateGroup<Reservation>>,
  reservations: Reservation[],
): DayTab[] {
  const rangeKeys = tripDateRangeKeys(trip?.start_date ?? null, trip?.end_date ?? null)
  const scheduledGroupKeys = groups.map((group) => group.dateKey).filter((key) => key !== UNSCHEDULED_KEY)
  const dateKeys = Array.from(new Set([...rangeKeys, ...scheduledGroupKeys])).sort()

  const days = dateKeys.map((key) => {
    const items = groupsByKey.get(key)?.items ?? []
    const activeStay = findActiveStay(key, reservations)
    const activeRental = findActiveVehicleRental(key, reservations)
    return {
      key,
      label: formatDayPillLabel(key),
      stayStatus: activeStay?.status ?? null,
      vehicleRentalStatus: activeRental?.status ?? null,
      itemCount: countDayItems(items, activeStay),
    }
  })

  const unscheduledGroup = groups.find((group) => group.dateKey === UNSCHEDULED_KEY)
  if (unscheduledGroup) {
    days.push({
      key: unscheduledGroup.dateKey,
      label: unscheduledGroup.label,
      stayStatus: null,
      vehicleRentalStatus: null,
      itemCount: unscheduledGroup.items.length,
    })
  }

  return days
}

/**
 * A multi-night Stay is only bucketed under its check-in day by groupByDate
 * (grouped by start_at), so a day it merely covers wouldn't otherwise count
 * it — `activeStay` fills that gap. Guarded against double-counting on the
 * check-in day itself, where the stay is already present in `items`.
 */
function countDayItems(items: Reservation[], activeStay: Reservation | null): number {
  if (!activeStay) return items.length
  const alreadyCounted = items.some((item) => item.id === activeStay.id)
  return alreadyCounted ? items.length : items.length + 1
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
 * Generalizes the day-edge free-time calculation (TABI-4) across every day
 * of the trip instead of just the selected one (TABI-149, desktop carousel).
 * The "Unscheduled" pseudo-day has no calendar date to bound a range with,
 * so it's excluded here exactly as the old single-day code excluded it.
 */
function buildDayEdgesByKey(
  trip: Trip,
  days: { key: string; label: string }[],
  groupsByKey: Map<string, DateGroup<Reservation>>,
): Map<string, DayEdges> {
  const input = days
    .filter((day) => day.key !== UNSCHEDULED_KEY)
    .map((day) => {
      const items = groupsByKey.get(day.key)?.items ?? []
      return {
        dateKey: day.key,
        timezone: items[0]?.start_timezone ?? localTimeZone(),
        items: items.filter((item): item is Reservation & { start_at: string } => item.start_at !== null),
      }
    })

  const blocks = computeDayEdgeFreeBlocks(input, trip.day_start_time, trip.day_end_time)

  const byKey = new Map<string, DayEdges>()
  for (const block of blocks) {
    const existing = byKey.get(block.dateKey) ?? {}
    if (block.position === 'leading') existing.leading = block
    else if (block.position === 'trailing') existing.trailing = block
    else existing.fullDay = block
    byKey.set(block.dateKey, existing)
  }
  return byKey
}
