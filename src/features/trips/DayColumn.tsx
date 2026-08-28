import { Link } from 'react-router-dom'
import { ReservationIcon, reservationTypeTextClasses } from '../../components/ui/ReservationTypeIcon'
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
import type { TripDayNote } from '../../types/dayNote'
import { resolveContextualLocation } from '../stay/computeAccommodationGaps'
import { DayNote } from './DayNote'
import { DayPlannedLocation } from './DayPlannedLocation'
import type { DayLocationInput } from './useTripDayLocations'

/** Where a free block's "+ Add" should center its nearby-places search (TABI-24). */
export type FreeBlockAddPayload = {
  startAt: string
  timezone: string | null
  contextLocation: { lat: number; lng: number } | null
}

/**
 * A reservation as it appears on one specific day's rail. A multi-night Stay
 * contributes two occurrences sharing the same underlying reservation id —
 * one on its check-in day, one on its check-out day (built by
 * `buildDayOccurrences` in TripTimeline.tsx) — so its checkout is visible on
 * its own day instead of only ever showing up folded into the check-in day's
 * trailing free time.
 */
export type DayItem = Reservation & {
  /** True for the check-out occurrence of a multi-night Stay (false/absent for its check-in occurrence and for every other reservation). */
  isCheckoutOccurrence?: boolean
  /** True for the arrival occurrence of a midnight/timezone-crossing Transport leg. */
  isArrivalOccurrence?: boolean
  /** True on a multi-night Stay's check-in occurrence — its post-checkout free time belongs to the check-out occurrence's own day, not this one. */
  suppressTrailingFreeBlock?: boolean
  /** True on a Transport arrival occurrence — no free time before it; the traveler was in transit before this day's window even opened. */
  suppressLeadingDayEdge?: boolean
  /** True on a Transport departure occurrence — no free time after it; the traveler remains in transit for the rest of this day's window. */
  suppressTrailingDayEdge?: boolean
}

type RailEntry =
  | { kind: 'reservation'; key: string; time: string | null; timezone: string | null; reservation: DayItem }
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
  | { kind: 'stay'; key: string; time: null; timezone: null; reservation: Reservation }
  | { kind: 'transit'; key: string; time: null; timezone: null; reservation: Reservation }

interface DayColumnProps {
  dayKey: string
  /** Only passed by the desktop carousel (TABI-149) — mobile relies on DayTabs to convey day identity instead. */
  label?: string
  items: DayItem[]
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
  /**
   * The Stay reservation covering this night, if any (TABI-158) — rendered as
   * an untimed block at the end of the rail so where you sleep tonight is
   * always visible, even on nights with no check-in event of their own.
   * Same "Unscheduled" pseudo-day omission as dayLocation/dayNote above.
   */
  activeStay?: Reservation | null
  /**
   * A point-to-point Transport leg still in progress (airborne/en route)
   * through this entire day — a 2+ calendar-day span's intermediate day,
   * which otherwise has no rail item of its own at all. Rendered as a
   * dedicated "In transit" block instead of the empty-day placeholder, so
   * the day never reads as silently unplanned (it's occupied, just not by
   * anything with a time on this particular day). Same "Unscheduled"
   * pseudo-day omission as dayLocation/dayNote above.
   */
  inProgressLeg?: Reservation | null
  /** Day-level note (TABI-56) — same "Unscheduled" pseudo-day omission as dayLocation above. */
  dayNote?: TripDayNote | null
  onSaveDayNote?: (note: string) => Promise<void>
  onClearDayNote?: () => Promise<void>
  /** Opens the quick-add sheet from a free-time block on the rail (TABI-54). */
  onAddAtFreeBlock?: (input: FreeBlockAddPayload) => void
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
  activeStay,
  inProgressLeg,
  dayNote,
  onSaveDayNote,
  onClearDayNote,
  onAddAtFreeBlock,
  className,
}: DayColumnProps) {
  const dayTimezone = items[0]?.start_timezone ?? localTimeZone()
  const anchorInstant = items[0]?.start_at

  const baseEntries =
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
      : items.length === 0 && inProgressLeg
        ? [{ kind: 'transit' as const, key: `transit-${inProgressLeg.id}`, time: null, timezone: null, reservation: inProgressLeg }]
        : buildRailEntries(items, freeTimeByFromId, edges)

  // Omitted when the stay's own check-in reservation already appears among
  // `items` for this day — that reservation card already answers "where do I
  // sleep tonight" with a real time, so a second untimed block would be a
  // confusing duplicate (TABI-158).
  const showTonightStay = activeStay && !items.some((item) => item.id === activeStay.id)
  const railEntries: RailEntry[] = showTonightStay
    ? [...baseEntries, { kind: 'stay', key: `stay-${activeStay.id}`, time: null, timezone: null, reservation: activeStay }]
    : baseEntries

  const contextLocation = resolveContextualLocation(activeStay ?? null, dayLocation)
  const handleAddAtFreeBlock = onAddAtFreeBlock
    ? (input: { startAt: string; timezone: string | null }) => onAddAtFreeBlock({ ...input, contextLocation })
    : undefined

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

      {(onSaveDayLocation && onClearDayLocation) || (onSaveDayNote && onClearDayNote) ? (
        <div className="flex flex-wrap items-center gap-2">
          {onSaveDayLocation && onClearDayLocation && (
            <DayPlannedLocation
              dayKey={dayKey}
              location={dayLocation ?? null}
              onSave={onSaveDayLocation}
              onClear={onClearDayLocation}
            />
          )}
          {onSaveDayNote && onClearDayNote && (
            <DayNote dayKey={dayKey} note={dayNote ?? null} onSave={onSaveDayNote} onClear={onClearDayNote} />
          )}
        </div>
      ) : null}

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
              {renderEntry(entry, handleAddAtFreeBlock)}
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
  items: DayItem[],
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

    // Bug: a departure and an arrival occurrence (or a check-in and check-out
    // occurrence) share the same underlying reservation id — normally harmless
    // since a split pair always landed on two different days, but the
    // unconditional Transport split (Bugs DB, "Comparaison de dates locales
    // dans des fuseaux différents peut coïncider par erreur") can now legitimately
    // land both occurrences of the same leg in this same day's `items`, which
    // produced two React list entries with an identical key.
    const occurrenceSuffix = reservation.isArrivalOccurrence
      ? '-arrival'
      : reservation.isCheckoutOccurrence
        ? '-checkout'
        : ''
    entries.push({
      kind: 'reservation',
      key: `${reservation.id}${occurrenceSuffix}`,
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
    // A multi-night Stay's check-in occurrence never owns this block either:
    // the pairwise gap always starts at the real checkout instant, which by
    // definition falls on a later calendar day than check-in, so it belongs
    // to the check-out occurrence's own day rail instead (TABI-112 follow-up).
    const block = reservation.suppressTrailingFreeBlock ? undefined : freeTimeByFromId.get(reservation.id)

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
      // The real pairwise gap to the actual next reservation can end sooner
      // than the day-window's own trailing cutoff — e.g. a Stay grouped under
      // its check-in day whose checkout, and the reservation right after it,
      // both land on a later calendar day, still well before that day's own
      // window ends. Use whichever bound is tighter so free time is never
      // overstated past a reservation that's actually coming up, while a next
      // reservation that's genuinely days away still gets capped at the
      // day-window's end (TABI-4).
      if (block && (!dayEdges.trailing || Date.parse(block.end) < Date.parse(dayEdges.trailing.end))) {
        if (block.durationSeconds >= MIN_FREE_SECONDS_TO_SHOW) {
          const freeStart = new Date(Date.parse(block.start) + block.travelSeconds * 1000).toISOString()
          entries.push({
            kind: 'free',
            key: `${reservation.id}-free`,
            time: freeStart,
            timezone: destinationTimezone,
            durationSeconds: block.durationSeconds,
          })
        }
      } else if (dayEdges.trailing) {
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

function renderEntry(
  entry: RailEntry,
  onAddAtFreeBlock?: (input: { startAt: string; timezone: string | null }) => void,
) {
  switch (entry.kind) {
    case 'reservation':
      return <ReservationCard reservation={entry.reservation} />
    case 'stay':
      return <TonightStayCard reservation={entry.reservation} />
    case 'transit':
      return <InTransitCard reservation={entry.reservation} />
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
        <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-dashed border-teal-200 bg-white px-4 py-3 text-sm font-medium text-teal-700">
          <span>{strings.planning.freeTime(formatDuration(entry.durationSeconds))}</span>
          {onAddAtFreeBlock && (
            <button
              type="button"
              onClick={() => onAddAtFreeBlock({ startAt: entry.time, timezone: entry.timezone })}
              aria-label={strings.planning.addAtFreeTime}
              title={strings.planning.addAtFreeTime}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 hover:bg-teal-200"
            >
              +
            </button>
          )}
        </div>
      )
  }
}

function ReservationCard({ reservation }: { reservation: DayItem }) {
  return (
    <Link
      to={`/reservations/${reservation.id}`}
      className="flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 hover:bg-slate-200"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white ${reservationTypeTextClasses[reservation.type]}`}
      >
        <ReservationIcon reservation={reservation} className="h-4 w-4" />
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

/**
 * Untimed "tonight's accommodation" block (TABI-158) — visually distinct from
 * `ReservationCard`'s solid, timed style (dashed border, muted icon, a
 * caption above the name) so it never reads as a scheduled event.
 */
function TonightStayCard({ reservation }: { reservation: Reservation }) {
  const location = reservation.start_place_name ?? reservation.start_city ?? reservation.start_address
  return (
    <Link
      to={`/reservations/${reservation.id}`}
      className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 hover:bg-slate-50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <ReservationIcon reservation={reservation} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-500">{strings.planning.tonightsStay}</p>
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClasses[reservation.status]}`} />
          <span className="truncate">{reservation.name}</span>
        </p>
        {location && <p className="truncate text-xs text-slate-500">{location}</p>}
      </div>
    </Link>
  )
}

/**
 * A day's only content when a Transport leg is in progress the whole day
 * (a 2+ calendar-day span's intermediate day) — same dashed, untimed
 * treatment as `TonightStayCard` since neither is a scheduled event on this
 * particular day, just a state the traveler is already in.
 */
function InTransitCard({ reservation }: { reservation: Reservation }) {
  return (
    <Link
      to={`/reservations/${reservation.id}`}
      className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 hover:bg-slate-50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <ReservationIcon reservation={reservation} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-500">{strings.planning.inTransit}</p>
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClasses[reservation.status]}`} />
          <span className="truncate">{reservation.name}</span>
        </p>
      </div>
    </Link>
  )
}

/** A day is flagged as a long-travel day (TABI-6) if any leg starting within it meets the too-long threshold. */
function dayHasTooLongTravel(items: Reservation[], freeTimeByFromId: Map<string, FreeTimeBlock>): boolean {
  return items.some((item) => freeTimeByFromId.get(item.id)?.tooLongTravel ?? false)
}

function rowLabel(reservation: DayItem): string | null {
  if (!reservation.start_at) return null
  const labels = strings.reservationLegLabels[reservation.type]
  const isEndOccurrence = reservation.isCheckoutOccurrence || reservation.isArrivalOccurrence
  const label = isEndOccurrence ? labels.end : labels.start
  return `${label} · ${formatTimeInZone(reservation.start_at, reservation.start_timezone)}`
}
