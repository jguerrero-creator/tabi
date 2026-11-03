import type { NewReservation } from '../../../src/types/reservation'

/**
 * Bugs DB: "11 specs e2e en échec depuis le sous-type checklist (26/09)" — the
 * checklist-subtype feature (commit 2c0df7d, 2026-09-26) added a CHECK constraint
 * requiring `activity_subtype` whenever `type` is `'activity'` (same mechanism as the
 * existing `stay_subtype` requirement for Stay). The app itself is never at risk of
 * hitting this — every real creation path funnels through `AddReservationModal`, whose
 * local state always defaults `activitySubtype` to `'place'` — but specs that seed an
 * Activity reservation directly via `.insert(...)`, bypassing that form, were left
 * silently broken for ~2 weeks until the full suite was next run.
 *
 * Use this helper for every direct Activity seed insert instead of a bare object
 * literal, so the next schema requirement like this one (see also the sibling
 * `stay_subtype`/`transport_subtype` requirements, unaffected today since every
 * existing spec already sets those) breaks one place instead of eleven files.
 */
export function activitySeed<T extends { type: 'activity'; activity_subtype?: NewReservation['activity_subtype'] }>(
  fields: T,
): T & { activity_subtype: NonNullable<NewReservation['activity_subtype']> } {
  return { activity_subtype: 'place', ...fields }
}

/**
 * Mirrors activitySeed() exactly, for the Meal type (Backlog: "Nouveau type de
 * réservation Repas") — Step 2's `reservations_meal_subtype_check` CHECK constraint
 * requires `meal_subtype` whenever `type` is `'meal'`, same mechanism/same lesson as
 * activitySeed's own comment above. Added in Step 3 (inert — nothing in the app can
 * produce `type: 'meal'` yet) precisely so the first spec that ever needs to seed a
 * Meal row directly doesn't rediscover this the hard way.
 */
export function mealSeed<T extends { type: 'meal'; meal_subtype?: NewReservation['meal_subtype'] }>(
  fields: T,
): T & { meal_subtype: NonNullable<NewReservation['meal_subtype']> } {
  return { meal_subtype: 'place', ...fields }
}
