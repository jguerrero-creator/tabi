import type { DayOccurrence } from './dayOccurrences'

type TimedOccurrence = DayOccurrence & { start_at: string }

export interface OccupiedCluster {
  /** Earliest-starting member — the real arrival target when this cluster is the destination of a gap. */
  entry: TimedOccurrence
  /**
   * The member whose own occupancy ends latest (ties: the one that started
   * latest) — the real departure point when this cluster is the origin of a
   * gap, since it's the one the traveler is actually still "inside" until
   * its own end, regardless of what else started and finished earlier.
   */
  owner: TimedOccurrence
  /** The latest-starting member (the last one merged in) — used only to anchor where a resulting block renders on the Planning rail, never for travel/location purposes (see `FreeTimeBlock.railAnchorReservationId`). */
  tail: TimedOccurrence
  /** `owner`'s effective end (`end_at ?? start_at`) — this cluster's occupied-until instant. */
  end: string
}

/**
 * Merges a start-sorted list of occurrences into the minimal set of
 * non-overlapping occupied intervals, treating touching boundaries (one ends
 * exactly when the next starts) as merged too — a zero-width gap is not real
 * free time, same outcome as the old `gapMs <= 0` skip it replaces.
 *
 * Fixes "Faux temps libre quand une réservation est imbriquée dans une plage
 * plus longue" (Bugs DB): the old free-time/leg computation paired only
 * *adjacent* occurrences after sorting by start time, so a longer-running
 * earlier occurrence (e.g. a full-day Activity) that fully or partially
 * contains a later-starting, earlier-ending one (e.g. a Meal) lost its
 * "still in progress" status the moment the nested occurrence's own end
 * passed — the gap after the nested occurrence was computed from ITS end,
 * not the true end of whichever occurrence the traveler is actually still
 * inside. Clustering first, then computing gaps only between clusters, means
 * the real occupied-until instant is always the latest end seen anywhere in
 * the cluster, however deep the nesting.
 */
export function buildOccupiedClusters(sortedByStart: readonly TimedOccurrence[]): OccupiedCluster[] {
  const clusters: OccupiedCluster[] = []

  for (const occ of sortedByStart) {
    const occEnd = occ.end_at ?? occ.start_at
    const current = clusters[clusters.length - 1]

    if (current && occ.start_at <= current.end) {
      current.tail = occ
      // A Stay check-in / Transport departure occurrence's `end_at` is an
      // artificial placeholder reaching to its real checkout/arrival — purely
      // so it correctly merges with whatever is nested before that real end,
      // never a genuine continuous-occupancy span the way an Activity's own
      // end is. Such an occurrence must therefore ALWAYS cede ownership to
      // any real (non-placeholder) member it merges with, regardless of
      // reach, or everything nested inside it (e.g. a same-day Activity
      // before a Stay's real checkout) would wrongly collapse into one
      // placeholder-owned cluster instead of keeping its own real gap to
      // whatever comes right after it (Bugs: a Stay check-out's own trailing
      // gap disappearing behind an Activity scheduled earlier that same day).
      // Ties among two real members still favor the latest-starting one —
      // see `OccupiedCluster.owner`'s doc comment.
      if (
        current.owner.suppressTrailingFreeBlock ||
        occEnd > current.end ||
        (occEnd === current.end && occ.start_at >= current.owner.start_at)
      ) {
        current.owner = occ
        current.end = occEnd
      }
    } else {
      clusters.push({ entry: occ, owner: occ, tail: occ, end: occEnd })
    }
  }

  return clusters
}

/**
 * The single occurrence among `items` whose own occupancy ends latest (ties:
 * the one that started latest) — used by `computeDayEdgeFreeBlocks` to find
 * the real last-to-finish item of a day, which is not necessarily the
 * last-by-start-time item once two reservations overlap.
 */
export function pickLatestEnding(items: readonly TimedOccurrence[]): TimedOccurrence {
  let best = items[0]
  let bestEnd = best.end_at ?? best.start_at

  for (let i = 1; i < items.length; i++) {
    const occ = items[i]
    const occEnd = occ.end_at ?? occ.start_at
    if (occEnd > bestEnd || (occEnd === bestEnd && occ.start_at >= best.start_at)) {
      best = occ
      bestEnd = occEnd
    }
  }

  return best
}
