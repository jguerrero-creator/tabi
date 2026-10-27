import type { ReservationType, TransportSubtype } from '../../types/reservation'

export interface FieldRequirements {
  requiresStart: boolean
  /** Never hard-required today for any type — a missing start time always falls back to a
   * default (Stay's check-in time, Transport's trip day-start time) instead of blocking
   * submission. Kept as its own field, not deleted, since it still governs the start time
   * input's `required` attribute. */
  requiresStartTime: boolean
  requiresEnd: boolean
  requiresEndTime: boolean
  requiresEndAddress: boolean
  /** TABI-108: overlap detection only runs within Stay or within Transport — Activity opted out
   * entirely. This is the explicit per-type decision, not a default a new type could silently
   * inherit (see reservationTypeSpecificFields.ts for the same "explicit, not inherited" shape). */
  checksOverlap: boolean
}

interface FieldRequirementsContext {
  transportSubtype: TransportSubtype
}

/**
 * Field-requirement policy per reservation type (TABI-121 for the Transport subtype split).
 * `Record<ReservationType, ...>` rather than an if/else chain (AddReservationModal's former
 * `mainType !== 'activity'` derivation) so that adding a type to the `ReservationType` union
 * without adding its entry here is a TypeScript compile error, not a silent fallback to the
 * wrong requirements.
 *
 * Each entry is a function (not a plain object) only because Transport's own requirements vary
 * by its subtype (point-to-point vs vehicle rental) — Stay and Activity ignore the context.
 */
export const fieldRequirementsByType: Record<ReservationType, (ctx: FieldRequirementsContext) => FieldRequirements> = {
  stay: () => ({
    requiresStart: true,
    requiresStartTime: false,
    requiresEnd: true,
    requiresEndTime: false,
    requiresEndAddress: false,
    checksOverlap: true,
  }),
  transport: ({ transportSubtype }) => {
    const isPointToPoint = transportSubtype === 'point_to_point'
    const isAtDisposal = transportSubtype === 'at_disposal'
    return {
      requiresStart: true,
      requiresStartTime: false,
      requiresEnd: true,
      requiresEndTime: isPointToPoint,
      requiresEndAddress: isPointToPoint || isAtDisposal,
      checksOverlap: true,
    }
  },
  activity: () => ({
    requiresStart: false,
    requiresStartTime: false,
    requiresEnd: false,
    requiresEndTime: false,
    requiresEndAddress: false,
    checksOverlap: false,
  }),
}
