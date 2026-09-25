import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import {
  computeReorderedTimes,
  findBestOrder,
  isMeaningfulImprovement,
  MAX_REORDER_STOPS,
  MIN_REORDER_STOPS,
  pairKey,
  totalTravelSeconds,
  type ReorderableActivity,
  type TravelMatrix,
} from '../../lib/activityReorder'
import { formatDuration } from '../../lib/duration'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import { legKey } from '../../lib/tripLegs'
import { fetchTravelTime } from '../../lib/travelTime'
import type { DayItem } from './DayColumn'
import type { TripLegModeState } from './useTripLegTravelModes'

type EligibleActivity = ReorderableActivity & { start_lat: number; start_lng: number }

// TABI-76: activities within a single day are almost always close enough together to
// walk between — unlike the "Getting Around" legs elsewhere, this suggestion has no
// per-leg mode picker (it's a background suggestion, not a user-driven choice), so a
// single sensible default keeps it from ever blocking on an unmade mode decision.
const REORDER_TRAVEL_MODE = 'WALK'

/**
 * Detects 3+ untimed (start_time_is_default) Activities on one Planning day and, if
 * reordering them would meaningfully cut total travel time, offers to apply the better
 * order — suggested only, per spec: dismissing changes nothing, and the same suggestion
 * is not re-shown for that exact set/order again this session.
 */
export function ActivityReorderSuggestion({
  items,
  legModeState,
  onReorder,
}: {
  items: DayItem[]
  /** Existing "Getting Around" leg results (TABI-200) — a pair already computed for this same mode is reused instead of an extra Routes API call. */
  legModeState: Record<string, TripLegModeState>
  onReorder: (updates: { id: string; start_at: string; end_at: string | null }[]) => Promise<void>
}) {
  const eligible = getEligibleActivities(items)
  const signature = eligible.map((activity) => `${activity.id}:${activity.start_at}`).join(',')

  const [suggestion, setSuggestion] = useState<{ signature: string; currentSeconds: number; best: ReorderableActivity[]; savingsSeconds: number } | null>(null)
  const [applying, setApplying] = useState(false)
  const dismissedSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (eligible.length < MIN_REORDER_STOPS || eligible.length > MAX_REORDER_STOPS) {
      setSuggestion(null)
      return
    }
    if (dismissedSignatureRef.current === signature) return

    let cancelled = false

    async function computeSuggestion() {
      const matrix: TravelMatrix = new Map()
      try {
        for (let i = 0; i < eligible.length; i++) {
          for (let j = i + 1; j < eligible.length; j++) {
            const a = eligible[i]
            const b = eligible[j]

            // Reuse an existing "Getting Around" leg result for this same mode/pair if one's
            // already been computed (either direction) — saves a Routes API call whenever this
            // pair happens to already be chronologically adjacent elsewhere in the itinerary.
            const cached = legModeState[legKey(a.id, b.id)] ?? legModeState[legKey(b.id, a.id)]
            if (cached?.mode === REORDER_TRAVEL_MODE && cached.computed && cached.durationSeconds !== null) {
              matrix.set(pairKey(a.id, b.id), cached.durationSeconds)
              continue
            }

            const result = await fetchTravelTime(
              { lat: a.start_lat, lng: a.start_lng },
              { lat: b.start_lat, lng: b.start_lng },
              REORDER_TRAVEL_MODE,
            )
            if (result.durationSeconds !== null) matrix.set(pairKey(a.id, b.id), result.durationSeconds)
          }
        }
      } catch (err) {
        logClientError('ActivityReorderSuggestion.fetchPairwiseTravelTimes', err)
        return
      }
      if (cancelled) return

      const currentOrder = [...eligible].sort((a, b) => a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id))
      const currentSeconds = totalTravelSeconds(currentOrder, matrix)
      const best = findBestOrder(eligible, matrix)
      if (currentSeconds === null || !best || !isMeaningfulImprovement(currentSeconds, best.totalSeconds)) {
        setSuggestion(null)
        return
      }
      setSuggestion({
        signature,
        currentSeconds,
        best: best.order,
        savingsSeconds: currentSeconds - best.totalSeconds,
      })
    }

    void computeSuggestion()
    return () => {
      cancelled = true
    }
    // Deliberately keyed on `signature` alone, not `legModeState` — the cache lookup above
    // just uses whatever's already known at the moment this day's set/order changes; a leg
    // mode picked *after* that shouldn't re-run the whole day's pairwise fetch + permutation
    // search over again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  if (!suggestion || suggestion.signature !== signature) return null

  async function handleApply() {
    if (!suggestion) return
    setApplying(true)
    try {
      await onReorder(computeReorderedTimes(suggestion.best))
      showSavedToast(strings.common.saved)
      setSuggestion(null)
    } catch (err) {
      logClientError('ActivityReorderSuggestion.apply', err)
    } finally {
      setApplying(false)
    }
  }

  function handleDismiss() {
    dismissedSignatureRef.current = signature
    setSuggestion(null)
  }

  return (
    <ConfirmDialog
      title={strings.activityReorder.title}
      message={strings.activityReorder.message(formatDuration(suggestion.savingsSeconds))}
      confirmLabel={strings.activityReorder.applyCta}
      onConfirm={handleApply}
      cancelLabel={strings.activityReorder.dismissCta}
      onCancel={handleDismiss}
      confirming={applying}
    />
  )
}

function getEligibleActivities(items: DayItem[]): EligibleActivity[] {
  return items.filter(
    (item): item is DayItem & EligibleActivity =>
      item.type === 'activity' &&
      item.start_time_is_default &&
      item.start_at !== null &&
      item.start_lat !== null &&
      item.start_lng !== null,
  )
}
