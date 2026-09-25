import { useEffect, useRef } from 'react'
import { groupByDate, UNSCHEDULED_KEY, type DateGroup } from '../../components/menu/groupByDate'
import { buildDayOccurrences } from '../../lib/dayOccurrences'
import { formatDayPillLabel, localTimeZone } from '../../lib/datetime'
import {
  computeDayEdgeFreeBlocks,
  computeFreeTimeBlocks,
  type DayEdgeFreeBlock,
  type FreeTimeBlock,
} from '../../lib/freeTimeBlocks'
import { strings } from '../../lib/strings'
import { findActiveStay } from '../stay/computeAccommodationGaps'
import { findArrivalJetlagLeg } from '../transport/findArrivalJetlagLeg'
import { findActiveVehicleRental } from '../transport/findActiveVehicleRental'
import { findInProgressTransportLeg } from '../transport/findInProgressTransportLeg'
import type { Reservation } from '../../types/reservation'
import type { Trip } from '../../types/trip'
import type { TripDayLocation } from '../../types/dayLocation'
import type { TripDayNote } from '../../types/dayNote'
import { ActivityReorderSuggestion } from './ActivityReorderSuggestion'
import { DayColumn, type DayItem, type FreeBlockAddPayload } from './DayColumn'
import { DayTabs, type DayTab } from './DayTabs'
import { ReservationDragProvider } from './reservationDrag'
import type { MoveCandidateDates } from '../../lib/reservationMove'
import type { TripLeg } from './useTripLegs'
import type { TripLegModeState } from './useTripLegTravelModes'
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
   * Drives the mobile single-day view's selection directly; the desktop
   * carousel (TABI-149) shows every day at once so it has no equivalent
   * "selection", but it does read this once on mount to restore horizontal
   * scroll position, and writes back to it as the user scrolls.
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
  onAddAtFreeBlock?: (input: FreeBlockAddPayload) => void
  /** Quick note access on a reservation card (Backlog: Planning slide-to-reveal / icon-strip). */
  onSaveReservationNote?: (reservationId: string, note: string) => Promise<void>
  /** Drag-and-drop reschedule on a reservation card (TABI-195). */
  onMoveReservation: (reservationId: string, dates: MoveCandidateDates) => Promise<void>
  /** TABI-76: applies an accepted "reorder these activities" suggestion. */
  onReorderActivities: (updates: { id: string; start_at: string; end_at: string | null }[]) => Promise<void>
  /** TABI-76: existing "Getting Around" leg results (TABI-200), reused where possible instead of an extra Routes API call. */
  legModeState: Record<string, TripLegModeState>
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
  onSaveReservationNote,
  onMoveReservation,
  onReorderActivities,
  legModeState,
}: TripTimelineProps) {
  const dayOccurrences = buildDayOccurrences(reservations)
  const groups = groupByDate(
    dayOccurrences,
    (item) => ({ at: item.start_at, timezone: item.start_timezone }),
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

  // Desktop has no day-tab concept (CLAUDE.md #18 — "Planning shows 3 days
  // side by side instead of tabs"): "the selected day" there is just
  // whichever column is scrolled into view in this overflow-x-auto
  // carousel, tracked nowhere. TABI-131's `?day=` URL persistence only ever
  // drove the mobile DayTabs below; a remount (e.g. navigating to a
  // reservation's detail screen — a separate top-level route — and back)
  // always reset the carousel to scrollLeft 0, silently losing whatever day
  // the user had actually scrolled to (Bugs DB regression report). These
  // hooks must run unconditionally before the empty-state early return
  // below, so they're declared here rather than next to the JSX that uses
  // them.
  const desktopCarouselRef = useRef<HTMLDivElement>(null)
  const initialDayKeyRef = useRef(selectedDayKey)
  const hasRestoredDesktopScrollRef = useRef(false)
  const daysRef = useRef(days)
  daysRef.current = days

  useEffect(() => {
    const el = desktopCarouselRef.current
    if (!el) return
    // scrollWidth / count rather than a hardcoded column width — approximates
    // one column's on-screen pitch (width + gap) however the carousel is
    // actually styled, instead of hardcoding Tailwind's current w-80/gap-4.
    const columnPitch = () => el.scrollWidth / Math.max(1, daysRef.current.length)

    if (!hasRestoredDesktopScrollRef.current) {
      hasRestoredDesktopScrollRef.current = true
      const targetKey = initialDayKeyRef.current
      const index = targetKey ? daysRef.current.findIndex((day) => day.key === targetKey) : -1
      if (index > 0) el.scrollLeft = index * columnPitch()
    }

    // Keeps the URL's `day` param in sync as the user scrolls, so the
    // *next* remount has something to restore from above. Debounced to
    // settle after scrolling stops rather than firing (and writing history)
    // on every frame.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const handleScroll = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const currentDays = daysRef.current
        const index = Math.max(
          0,
          Math.min(currentDays.length - 1, Math.round(el.scrollLeft / columnPitch())),
        )
        const day = currentDays[index]
        if (day) onSelectDay(day.key)
      }, 150)
    }
    el.addEventListener('scroll', handleScroll)
    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (debounceTimer) clearTimeout(debounceTimer)
    }
    // Re-run when the carousel div actually mounts (days.length flips from
    // 0, below the empty-state return) or `onSelectDay` changes identity —
    // not on every `days` recompute, which would tear down and reattach the
    // listener on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length === 0, onSelectDay])

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

  const dayEdgesByKey = trip ? buildDayEdgesByKey(trip, days, groupsByKey, reservations) : new Map<string, DayEdges>()

  return (
    <ReservationDragProvider reservations={reservations} onMove={onMoveReservation}>
      {/*
        TABI-76: rendered once here (not inside DayColumn) — mobile-day-view and
        desktop-day-carousel below are both always mounted (CSS breakpoints toggle which
        is visible, not which exists), so a per-DayColumn instance would double the
        pairwise-travel-time API calls and stack two full-screen confirm dialogs for the
        same day. `effectiveSelectedKey` also tracks the desktop carousel's own scroll
        position (see the scroll-sync effect above), so "the day currently in focus" is a
        meaningful single day even in the desktop multi-column layout.
      */}
      {effectiveSelectedKey !== UNSCHEDULED_KEY && (
        <ActivityReorderSuggestion
          items={groupsByKey.get(effectiveSelectedKey)?.items ?? []}
          legModeState={legModeState}
          onReorder={onReorderActivities}
        />
      )}

      <div data-testid="mobile-day-view" className="space-y-4 lg:hidden">
        <DayTabs days={days} selectedKey={effectiveSelectedKey} onSelect={onSelectDay} />
        <DayColumn
          dayKey={effectiveSelectedKey}
          items={groupsByKey.get(effectiveSelectedKey)?.items ?? []}
          freeTimeByFromId={freeTimeByFromId}
          edges={dayEdgesByKey.get(effectiveSelectedKey) ?? {}}
          activeStay={
            effectiveSelectedKey === UNSCHEDULED_KEY ? null : findActiveStay(effectiveSelectedKey, reservations)
          }
          inProgressLeg={
            effectiveSelectedKey === UNSCHEDULED_KEY ||
            (groupsByKey.get(effectiveSelectedKey)?.items.length ?? 0) > 0
              ? null
              : findInProgressTransportLeg(effectiveSelectedKey, reservations)
          }
          dayLocation={dayLocationsByKey.get(effectiveSelectedKey)}
          onAddAtFreeBlock={onAddAtFreeBlock}
          onSaveReservationNote={onSaveReservationNote}
          onHoverDaySwitch={onSelectDay}
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

      <div
        ref={desktopCarouselRef}
        data-testid="desktop-day-carousel"
        className="hidden gap-4 overflow-x-auto pb-4 lg:flex lg:snap-x lg:snap-mandatory"
      >
        {days.map((day) => (
          <DayColumn
            key={day.key}
            dayKey={day.key}
            label={day.label}
            items={groupsByKey.get(day.key)?.items ?? []}
            freeTimeByFromId={freeTimeByFromId}
            edges={dayEdgesByKey.get(day.key) ?? {}}
            activeStay={day.key === UNSCHEDULED_KEY ? null : findActiveStay(day.key, reservations)}
            inProgressLeg={
              day.key === UNSCHEDULED_KEY || (groupsByKey.get(day.key)?.items.length ?? 0) > 0
                ? null
                : findInProgressTransportLeg(day.key, reservations)
            }
            dayLocation={dayLocationsByKey.get(day.key)}
            onAddAtFreeBlock={onAddAtFreeBlock}
            onSaveReservationNote={onSaveReservationNote}
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
    </ReservationDragProvider>
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
 * rental status, probable-jetlag flag (TABI-66), and total item count
 * (TABI-143), computed here once for every day rather than re-derived per pill.
 */
function buildDayTabs(
  trip: Trip | null,
  groups: DateGroup<DayItem>[],
  groupsByKey: Map<string, DateGroup<DayItem>>,
  reservations: Reservation[],
): DayTab[] {
  const rangeKeys = tripDateRangeKeys(trip?.start_date ?? null, trip?.end_date ?? null)
  const scheduledGroupKeys = groups.map((group) => group.dateKey).filter((key) => key !== UNSCHEDULED_KEY)
  const dateKeys = Array.from(new Set([...rangeKeys, ...scheduledGroupKeys])).sort()

  const days = dateKeys.map((key) => {
    const items = groupsByKey.get(key)?.items ?? []
    const activeStay = findActiveStay(key, reservations)
    const activeRental = findActiveVehicleRental(key, reservations)
    const inProgressLeg = items.length === 0 ? findInProgressTransportLeg(key, reservations) : null
    return {
      key,
      label: formatDayPillLabel(key),
      stayStatus: activeStay?.status ?? null,
      vehicleRentalStatus: activeRental?.status ?? null,
      hasJetlag: findArrivalJetlagLeg(key, reservations) !== null,
      itemCount: countDayItems(items, activeStay, inProgressLeg),
    }
  })

  const unscheduledGroup = groups.find((group) => group.dateKey === UNSCHEDULED_KEY)
  if (unscheduledGroup) {
    days.push({
      key: unscheduledGroup.dateKey,
      label: unscheduledGroup.label,
      stayStatus: null,
      vehicleRentalStatus: null,
      hasJetlag: false,
      itemCount: unscheduledGroup.items.length,
    })
  }

  return days
}

/**
 * A multi-night Stay is only bucketed under its check-in day by groupByDate
 * (grouped by start_at), so a day it merely covers wouldn't otherwise count
 * it — `activeStay` fills that gap. Guarded against double-counting on the
 * check-in day itself, where the stay is already present in `items`. A
 * Transport leg in progress through an intermediate day of a 2+ day span
 * (`inProgressLeg`) has no occurrence of its own on that day either — same
 * gap, same fix — but per `findInProgressTransportLeg`, it's only ever
 * non-null when `items` is already empty, so no double-counting guard is
 * needed for it.
 *
 * `items` itself is deduped by reservation id before counting: a Transport
 * leg whose departure and arrival occurrences (`buildDayOccurrences`) both
 * land in the same day's group — either a genuine same-timezone same-day hop,
 * or two different-timezone legs whose independently-computed local dates
 * happen to read the same string — is still exactly one booking, and the
 * item-count badge should read "1" for it either way (Bugs DB, Majeur — "Le
 * split Départ/Arrivée inconditionnel fait compter en double les Transport
 * sur une même journée").
 */
function countDayItems(items: DayItem[], activeStay: Reservation | null, inProgressLeg: Reservation | null): number {
  const distinctItemCount = new Set(items.map((item) => item.id)).size
  const stayCount = activeStay && !items.some((item) => item.id === activeStay.id) ? 1 : 0
  const inProgressCount = inProgressLeg ? 1 : 0
  return distinctItemCount + stayCount + inProgressCount
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
  groupsByKey: Map<string, DateGroup<DayItem>>,
  reservations: Reservation[],
): Map<string, DayEdges> {
  const input = days
    .filter((day) => day.key !== UNSCHEDULED_KEY)
    .map((day) => {
      const items = groupsByKey.get(day.key)?.items ?? []
      const inProgressLeg = items.length === 0 ? findInProgressTransportLeg(day.key, reservations) : null
      return {
        dateKey: day.key,
        timezone: items[0]?.start_timezone ?? localTimeZone(),
        items: items.filter((item): item is DayItem & { start_at: string } => item.start_at !== null),
        fullyOccupied: inProgressLeg !== null,
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

