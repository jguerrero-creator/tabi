/**
 * TABI-76: suggest reordering a day's untimed (start_time_is_default) Activities to
 * minimize total travel time between them — "simplified" per spec, so this is exhaustive
 * search over every permutation rather than a real TSP solver, bounded by
 * `MAX_REORDER_STOPS` so the search space (`n!`) and the pairwise-distance API calls
 * (`n*(n-1)/2`) both stay small. 8! = 40,320 array-sum comparisons is effectively
 * instant; a day with more untimed stops than that isn't a realistic single-day
 * itinerary anyway, so it's simply skipped rather than switched to a heuristic.
 */
export const MAX_REORDER_STOPS = 8
export const MIN_REORDER_STOPS = 3

export interface ReorderableActivity {
  id: string
  start_at: string
  end_at: string | null
}

/** Symmetric pairwise travel duration (seconds), keyed by `pairKey` — direction is not distinguished (see `pairKey`). */
export type TravelMatrix = Map<string, number>

/** Order-independent key for a pair of reservation ids — travel time is fetched once per unordered pair and reused for both directions, a deliberate "simplified TSP" cost-saving (real one-way asymmetry is ignored). */
export function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`
}

/** Sum of consecutive-pair travel times for one candidate order; null if any pair is missing from `matrix`. */
export function totalTravelSeconds(order: ReorderableActivity[], matrix: TravelMatrix): number | null {
  let total = 0
  for (let i = 0; i < order.length - 1; i++) {
    const seconds = matrix.get(pairKey(order[i].id, order[i + 1].id))
    if (seconds === undefined) return null
    total += seconds
  }
  return total
}

/** Every permutation of `items` (Heap's algorithm) — only ever called at `MAX_REORDER_STOPS` or fewer items. */
export function permutations<T>(items: T[]): T[][] {
  const result: T[][] = []
  const arr = [...items]
  const c = new Array(arr.length).fill(0)
  result.push([...arr])
  let i = 0
  while (i < arr.length) {
    if (c[i] < i) {
      const swapIndex = i % 2 === 0 ? 0 : c[i]
      ;[arr[swapIndex], arr[i]] = [arr[i], arr[swapIndex]]
      result.push([...arr])
      c[i] += 1
      i = 0
    } else {
      c[i] = 0
      i += 1
    }
  }
  return result
}

export interface BestOrderResult {
  order: ReorderableActivity[]
  totalSeconds: number
}

/** Exhaustive search for the permutation with the lowest total travel time; null if `matrix` doesn't cover every pair. */
export function findBestOrder(activities: ReorderableActivity[], matrix: TravelMatrix): BestOrderResult | null {
  let best: BestOrderResult | null = null
  for (const order of permutations(activities)) {
    const seconds = totalTravelSeconds(order, matrix)
    if (seconds === null) continue
    if (!best || seconds < best.totalSeconds) best = { order, totalSeconds: seconds }
  }
  return best
}

// A reorder is only worth interrupting the user for when it saves a real chunk of the
// day, not a rounding error's worth of walking — both floors (absolute and relative)
// must clear, so a short travel-heavy day (where 15% is only a minute or two) and a long
// one (where 10 minutes is barely 2%) each still need a genuinely meaningful win.
const MIN_IMPROVEMENT_SECONDS = 10 * 60
const MIN_IMPROVEMENT_RATIO = 0.15

export function isMeaningfulImprovement(currentSeconds: number, bestSeconds: number): boolean {
  if (currentSeconds <= 0) return false
  const improvement = currentSeconds - bestSeconds
  return improvement >= MIN_IMPROVEMENT_SECONDS && improvement / currentSeconds >= MIN_IMPROVEMENT_RATIO
}

/** Nominal spacing so two chained activities keep distinct timestamps when one has no duration set (TABI-181: duration is optional for an Activity). */
const UNDURATED_STOP_SPACING_MS = 30 * 60 * 1000

/**
 * Recomputes each activity's start/end for a new order, chained back-to-back from the
 * group's own earliest current start — accepting a suggestion re-sequences these
 * activities without shifting *when* in the day they sit. Each activity's own real
 * duration (end_at - start_at) is preserved; one with no duration set just advances the
 * cursor by a nominal spacing rather than persisting a fabricated end_at.
 */
export function computeReorderedTimes(
  order: ReorderableActivity[],
): { id: string; start_at: string; end_at: string | null }[] {
  const anchor = Math.min(...order.map((activity) => Date.parse(activity.start_at)))
  let cursor = anchor
  return order.map((activity) => {
    const hasDuration = activity.end_at !== null
    const durationMs = hasDuration
      ? Date.parse(activity.end_at as string) - Date.parse(activity.start_at)
      : UNDURATED_STOP_SPACING_MS
    const startAt = new Date(cursor).toISOString()
    const endAt = hasDuration ? new Date(cursor + durationMs).toISOString() : null
    cursor += durationMs
    return { id: activity.id, start_at: startAt, end_at: endAt }
  })
}
