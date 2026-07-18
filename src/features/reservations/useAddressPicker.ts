import { useCallback, useRef, useState } from 'react'
import type { GeocodeCandidate } from '../../lib/geocode'

/**
 * Bridges the async resolveAddress() call with a picker modal: requestPick()
 * surfaces candidates and returns a promise that resolves once the user picks
 * one (or cancels), letting the caller's submit flow simply `await` it.
 */
export function useAddressPicker() {
  const [candidates, setCandidates] = useState<GeocodeCandidate[] | null>(null)
  const resolverRef = useRef<((candidate: GeocodeCandidate | null) => void) | null>(null)

  const requestPick = useCallback((next: GeocodeCandidate[]) => {
    setCandidates(next)
    return new Promise<GeocodeCandidate | null>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  function selectCandidate(candidate: GeocodeCandidate) {
    setCandidates(null)
    resolverRef.current?.(candidate)
    resolverRef.current = null
  }

  function cancelPick() {
    setCandidates(null)
    resolverRef.current?.(null)
    resolverRef.current = null
  }

  return { candidates, requestPick, selectCandidate, cancelPick }
}
