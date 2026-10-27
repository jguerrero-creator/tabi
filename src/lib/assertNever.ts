/**
 * Exhaustiveness helper for a `switch` over a union type (e.g. `ReservationType`): put
 * `default: return assertNever(x)` as the last case. If a union member isn't handled by an
 * earlier case, `x` isn't narrowed to `never` there and TypeScript refuses to compile — the
 * whole point being that adding a new member (e.g. a future `'meal'` reservation type) turns a
 * missed branch into a build failure instead of a silent runtime fallback.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`)
}
