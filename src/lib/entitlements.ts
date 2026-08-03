// Central plan -> features/limits mapping (TABI-97), plus the single
// "is this action allowed?" check (TABI-98) that both client and server call
// instead of ever comparing `plan` themselves.
export type Plan = 'free'

export interface PlanEntitlements {
  features: {
    aiAccess: boolean
    inviteTravelers: boolean
  }
  limits: {
    maxActiveTrips: number | null
    maxTripDurationDays: number | null
  }
}

// `null` limit = unlimited. aiAccess is enabled on free (TABI-177 wired the
// server-side check without restricting today's users). maxActiveTrips is set
// per TABI-101; maxTripDurationDays is still undecided (left unlimited).
export const ENTITLEMENTS: Record<Plan, PlanEntitlements> = {
  free: {
    features: {
      aiAccess: true,
      inviteTravelers: false,
    },
    limits: {
      maxActiveTrips: 3,
      maxTripDurationDays: null,
    },
  },
}

export function getEntitlements(plan: Plan): PlanEntitlements {
  return ENTITLEMENTS[plan]
}

export type EntitlementCheck =
  | { feature: keyof PlanEntitlements['features'] }
  | { limit: keyof PlanEntitlements['limits']; currentValue: number }

// The one place that decides "is this action allowed for this account?".
// Callers never read `plan` or ENTITLEMENTS themselves.
export function checkEntitlement(plan: Plan, check: EntitlementCheck): boolean {
  const entitlements = getEntitlements(plan)

  if ('feature' in check) {
    return entitlements.features[check.feature]
  }

  const limit = entitlements.limits[check.limit]
  return limit === null || check.currentValue < limit
}
