import type { MealSubtype, ReservationType, ActivitySubtype } from '../../types/reservation'

type PlaceOrChecklistSubtype = ActivitySubtype | MealSubtype

/**
 * Deliberately NOT `Pick<Reservation, ...>` — the subtype fields are optional here
 * (matching how callers like `ReservationIconInput` already type them) so this accepts
 * both a full `Reservation` row (required, nullable fields — structurally assignable to
 * an optional field) and a lighter object that simply omits a column it doesn't carry.
 * "Missing" and "null" mean the same thing to every function below.
 */
interface SubtypeBearingReservation {
  type: ReservationType
  activity_subtype?: ActivitySubtype | null
  meal_subtype?: MealSubtype | null
}

/**
 * Shared "place or checklist" model (Backlog: "Nouveau type de réservation Repas") —
 * Activity and Meal are the two reservation types that store either a single fixed
 * place or a checklist of candidates, each in its own subtype column
 * (activity_subtype / meal_subtype). These three helpers replace the scattered
 * `reservation.type === 'activity' && reservation.activity_subtype === 'checklist'`
 * checks across the codebase with one shared definition, so a Meal checklist is
 * recognized everywhere an Activity checklist already is, instead of silently falling
 * through every one of those checks (no compile error either way — `activity_subtype`
 * and `type === 'activity'` are both still perfectly valid TypeScript for a Meal row,
 * they just evaluate to the wrong answer).
 *
 * Step 4a only introduces these and swaps in the read-only predicate usages that
 * already operate on a real `Reservation` row (DayColumn, ReservationIcon,
 * ReservationDetailScreen's `isChecklist`) — never behavior-changing for Stay,
 * Transport or Activity today, see the accompanying unit tests. Usages that would
 * require NEW Meal state/UI that doesn't exist yet (AddReservationModal's form-state
 * isChecklist, the place<->checklist conversion write path) are deliberately left
 * alone — see the Step 4a report for the full inventory and reasoning.
 */

/** True for the two reservation types that use the place-or-checklist model. */
export function isPlaceOrChecklistType(type: ReservationType): boolean {
  return type === 'activity' || type === 'meal'
}

/**
 * Reads whichever subtype column actually applies to this reservation's type — never
 * both, never the wrong one. Returns null for Stay/Transport (which have their own,
 * unrelated subtype columns) regardless of what (should always be null there anyway,
 * per the DB's own per-type CHECK constraints) those other columns contain.
 */
export function getPlaceOrChecklistSubtype(reservation: SubtypeBearingReservation): PlaceOrChecklistSubtype | null {
  if (reservation.type === 'activity') return reservation.activity_subtype ?? null
  if (reservation.type === 'meal') return reservation.meal_subtype ?? null
  return null
}

/**
 * True for a checklist-subtype Activity OR a checklist-subtype Meal — the single
 * condition that gates status-hiding, book-by-hiding, the address field, and
 * ChecklistItemsSection across the app. Built on getPlaceOrChecklistSubtype so there's
 * exactly one place that knows which column belongs to which type.
 */
export function isChecklistReservation(reservation: SubtypeBearingReservation): boolean {
  return getPlaceOrChecklistSubtype(reservation) === 'checklist'
}
