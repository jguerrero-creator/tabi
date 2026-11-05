const STORAGE_KEY = 'tabi.feature.meals'

/**
 * Feature switch for the Meal reservation type (Backlog: "Nouveau type de réservation
 * Repas") — gates every user entry point to Meal added in later steps (the Add form's
 * type option, the nav tab, the route). A plain localStorage flag, not an environment
 * variable: this is a local, per-browser toggle for manual QA during rollout, not a
 * server-controlled flag, and CLAUDE.md's entitlements layer (`requireEntitlement`) is
 * a separate, unrelated mechanism for paid-plan gating — this isn't that either.
 *
 * Step 4a only creates and tests this. Nothing reads it yet, so nothing changes.
 *
 * To turn on in the browser console (any trip page): `localStorage.setItem('tabi.feature.meals', '1')`, then reload.
 * To turn off: `localStorage.removeItem('tabi.feature.meals')`, then reload.
 */
export function isMealsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Storage blocked (private browsing, disabled cookies/storage, or no `localStorage`
    // global at all e.g. during SSR/tests) — the feature simply stays off, never a crash.
    return false
  }
}
