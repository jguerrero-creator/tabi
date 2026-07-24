declare global {
  interface Window {
    gm_authFailure?: () => void
  }
}

/**
 * TABI-167: billing-disabled/quota-exceeded/invalid-key failures on the Maps
 * JavaScript API are delivered via this global callback, not a thrown
 * exception — MapErrorBoundary's componentDidCatch never sees them. Google
 * invokes window.gm_authFailure itself once it detects the failure, so we
 * only need to register the callback and let subscribers react.
 */
let hasFailed = false
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.gm_authFailure = () => {
    hasFailed = true
    listeners.forEach((listener) => listener())
  }
}

export function isMapsAuthFailure(): boolean {
  return hasFailed
}

export function subscribeMapsAuthFailure(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
