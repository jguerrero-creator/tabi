import { findOverlappingReservation } from '../features/reservations/reservationOverlap'
import { strings } from './strings'
import type { DayOccurrence } from './dayOccurrences'
import type { Reservation } from '../types/reservation'

/**
 * A free-time rail entry, tagged as a drop target via `data-drop-target="free"`
 * (see `dropTargetProps` below) and read back with `document.elementFromPoint`
 * during a touch drag — this avoids needing every DayColumn instance (mobile's
 * single column, desktop's multi-column carousel) to register pixel rects with
 * a shared context; the DOM itself is the source of truth for what's under the
 * finger, same as native HTML5 drag-and-drop's own hit-testing model. Plain TS
 * (no React import), same reasoning as `dayOccurrences.ts` — kept importable
 * without pulling the component tree in, and Vite fast-refresh only works
 * cleanly on a file that exports components alone.
 */
export interface FreeDropTarget {
  dayKey: string
  /** UTC ISO instant — the free block's own start, i.e. exactly where a drop lands. */
  time: string
  timezone: string | null
  durationSeconds: number
}

export interface MoveCandidateDates {
  start_at: string
  start_timezone: string | null
  end_at: string | null
  end_timezone: string | null
}

/**
 * Occurrence-aware (TABI-195): dragging a multi-night Stay's check-out card
 * (or a midnight/timezone-crossing Transport's arrival card) only moves that
 * end of the booking — `start_at` stays put, mirroring how
 * `buildDayOccurrences` split the two in the first place. Dragging any other
 * occurrence (a check-in, a departure, or an ordinary single-occurrence
 * reservation) shifts the whole thing, preserving its original duration
 * exactly. Timezone fields are never rewritten by a move, on either branch —
 * only the UTC instants shift — so a Transport leg's real departure/arrival
 * cities (or a Stay/Activity's real place) are never silently re-geocoded
 * just because the booking moved to a new time slot; only the two true
 * `start_at`/`end_at` instants on the underlying record (`original`, not the
 * display-adjusted occurrence) are ever read as the move's basis.
 */
export function computeMoveCandidate(
  occurrence: DayOccurrence,
  original: Reservation,
  target: FreeDropTarget,
): MoveCandidateDates | null {
  if (occurrence.isCheckoutOccurrence || occurrence.isArrivalOccurrence) {
    if (!original.start_at || !original.end_at || target.time === original.end_at) return null
    return {
      start_at: original.start_at,
      start_timezone: original.start_timezone,
      end_at: target.time,
      end_timezone: original.end_timezone,
    }
  }

  if (!original.start_at || target.time === original.start_at) return null

  const deltaMs = Date.parse(target.time) - Date.parse(original.start_at)
  return {
    start_at: target.time,
    start_timezone: original.start_timezone,
    end_at: original.end_at ? new Date(Date.parse(original.end_at) + deltaMs).toISOString() : null,
    end_timezone: original.end_timezone,
  }
}

/**
 * Validates a drop before it's committed: the candidate range must still make
 * sense (end after start), a whole-item move must fit inside the target free
 * block's own remaining duration (already net of travel time — see
 * `computeFreeTimeBlocks`), and — the same defensive check a manual edit
 * would get — must not overlap another reservation of the same type
 * (`findOverlappingReservation`, TABI-108: overlap is only ever meaningful
 * within Stay or within Transport). An endpoint-only move (checkout/arrival)
 * skips the duration-fit check: it isn't placing a whole item into a gap, just
 * relocating one boundary of an existing one.
 */
export function validateMove(
  occurrence: DayOccurrence,
  candidate: MoveCandidateDates,
  original: Reservation,
  target: FreeDropTarget,
  allReservations: Reservation[],
): { ok: true } | { ok: false; reason: string } {
  if (!candidate.end_at) return { ok: true }

  if (Date.parse(candidate.end_at) <= Date.parse(candidate.start_at)) {
    return { ok: false, reason: strings.planningDrag.invalidRange }
  }

  const isEndpointMove = occurrence.isCheckoutOccurrence || occurrence.isArrivalOccurrence
  if (!isEndpointMove && original.start_at && original.end_at) {
    const durationSeconds = (Date.parse(original.end_at) - Date.parse(original.start_at)) / 1000
    if (durationSeconds > target.durationSeconds) {
      return { ok: false, reason: strings.planningDrag.doesNotFit }
    }
  }

  const sameType = allReservations.filter((r) => r.id !== original.id && r.type === original.type)
  const overlap = findOverlappingReservation({ start_at: candidate.start_at, end_at: candidate.end_at }, sameType)
  if (overlap) {
    return { ok: false, reason: strings.planningDrag.overlapRejected(overlap.name) }
  }

  return { ok: true }
}

/** Reads whatever free-time drop target is currently under a touch point, via DOM attributes (see `FreeDropTarget`). */
export function hitTestDropTarget(x: number, y: number): { dropId: string; target: FreeDropTarget } | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-target="free"]')
  if (!el) return null
  const { dropId, dayKey, time, timezone, durationSeconds } = el.dataset
  if (!dropId || !dayKey || !time || durationSeconds === undefined) return null
  return { dropId, target: { dayKey, time, timezone: timezone ?? null, durationSeconds: Number(durationSeconds) } }
}

/**
 * Mobile has only one DayColumn mounted at a time (DayTabs picks which),
 * unlike desktop's side-by-side carousel — so a cross-day drop needs the
 * day tab itself to be a hover target that switches the visible column
 * (see `DayTabs`'s `data-day-tab`), before the finger can reach that day's
 * own free-time blocks underneath to actually drop.
 */
export function hitTestDayTab(x: number, y: number): string | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day-tab]')?.dataset.dayTab ?? null
}

/** Spreads onto a free-time rail entry (or the empty-day fallback block) to make it a valid drop target. */
export function dropTargetProps(dropId: string, target: FreeDropTarget): Record<string, string> {
  return {
    'data-drop-target': 'free',
    'data-drop-id': dropId,
    'data-day-key': target.dayKey,
    'data-time': target.time,
    'data-timezone': target.timezone ?? '',
    'data-duration-seconds': String(target.durationSeconds),
  }
}
