import { assertNever } from '../../lib/assertNever'
import type {
  ActivitySubtype,
  MealSubtype,
  NewReservation,
  ReservationType,
  StaySubtype,
  TransportMode,
  TransportSubtype,
} from '../../types/reservation'

export type TypeSpecificColumns = Pick<
  NewReservation,
  | 'stay_subtype'
  | 'stay_parking_included'
  | 'stay_check_in_deadline'
  | 'transport_subtype'
  | 'transport_mode'
  | 'activity_subtype'
  | 'meal_subtype'
>

interface TypeSpecificFieldsInput {
  staySubtype: StaySubtype
  parkingIncluded: boolean | null
  /** Raw form value (`''` when unset) — matches the original `checkInDeadline ? checkInDeadline : null` truthy check exactly. */
  checkInDeadline: string
  transportSubtype: TransportSubtype
  transportMode: TransportMode | null
  isPointToPoint: boolean
  activitySubtype: ActivitySubtype
  /**
   * Required, not optional or nullable — same shape as `activitySubtype` above. The
   * `reservations_meal_subtype_check` DB constraint (Step 2) rejects `type = 'meal'` with a
   * null `meal_subtype`; making this field non-optional means the 'meal' case below can
   * only ever write `input.mealSubtype` directly, so this builder can never construct that
   * invalid combination — there's no `null` fallback path to accidentally take. A future
   * caller (Step 4's Add form) owns the actual default ('place', mirroring Activity's own
   * `defaultActivitySubtype`), same as it does for `activitySubtype` today.
   */
  mealSubtype: MealSubtype
}

/**
 * Builds the one populated subtype column (plus its sibling type's columns, explicitly nulled)
 * for a reservation submit/patch payload — one function call per type, instead of the four
 * independent `dbType === 'x' ? ... : null` ternaries this replaced. The exhaustive switch
 * ending in `assertNever` means a new `ReservationType` member with no case here is a
 * TypeScript compile error, not three silently-still-null subtype columns.
 */
export function buildTypeSpecificColumns(dbType: ReservationType, input: TypeSpecificFieldsInput): TypeSpecificColumns {
  switch (dbType) {
    case 'stay':
      return {
        stay_subtype: input.staySubtype,
        stay_parking_included: input.parkingIncluded,
        stay_check_in_deadline: input.checkInDeadline ? input.checkInDeadline : null,
        transport_subtype: null,
        transport_mode: null,
        activity_subtype: null,
        meal_subtype: null,
      }
    case 'transport':
      return {
        stay_subtype: null,
        stay_parking_included: null,
        stay_check_in_deadline: null,
        transport_subtype: input.transportSubtype,
        // TABI-122: only a point-to-point leg carries a transport mode (flight/train/...) —
        // a vehicle rental's "mode" is implicitly "car", never asked for separately.
        transport_mode: input.isPointToPoint ? input.transportMode : null,
        activity_subtype: null,
        meal_subtype: null,
      }
    case 'activity':
      return {
        stay_subtype: null,
        stay_parking_included: null,
        stay_check_in_deadline: null,
        transport_subtype: null,
        transport_mode: null,
        activity_subtype: input.activitySubtype,
        meal_subtype: null,
      }
    // Step 3 (Meal plan) — unreachable from any UI yet (AddReservationModal's
    // mainTypeOptions doesn't offer 'meal'), but handled for real so this switch stays
    // exhaustive. input.mealSubtype is required (see TypeSpecificFieldsInput above), so
    // this can never write `meal_subtype: null` for a meal row.
    case 'meal':
      return {
        stay_subtype: null,
        stay_parking_included: null,
        stay_check_in_deadline: null,
        transport_subtype: null,
        transport_mode: null,
        activity_subtype: null,
        meal_subtype: input.mealSubtype,
      }
    default:
      return assertNever(dbType)
  }
}
