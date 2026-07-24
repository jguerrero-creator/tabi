import { Component, type ErrorInfo, type ReactNode } from 'react'
import { strings } from '../../lib/strings'
import { isMapsAuthFailure, subscribeMapsAuthFailure } from '../../lib/mapsAuthFailure'

interface MapErrorBoundaryProps {
  children: ReactNode
  className?: string
  heightClassName?: string
}

interface MapErrorBoundaryState {
  hasError: boolean
}

/**
 * TABI-161: the Maps JS SDK (via @vis.gl/react-google-maps) constructs
 * `google.maps.Map` in a useLayoutEffect with no internal try/catch, so an
 * auth failure (e.g. RefererNotAllowedMapError) throws synchronously and
 * would otherwise unmount the whole React tree. This confines that failure
 * to the map area.
 *
 * TABI-167: billing-disabled/quota-exceeded failures don't throw at all —
 * Google reports them through the global window.gm_authFailure callback
 * instead, which componentDidCatch can never see. We also subscribe to that
 * callback so those failures render the same fallback.
 */
export class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { hasError: isMapsAuthFailure() }
  private unsubscribe?: () => void

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Map failed to render.', error, errorInfo)
  }

  componentDidMount() {
    this.unsubscribe = subscribeMapsAuthFailure(() => this.setState({ hasError: true }))
  }

  componentWillUnmount() {
    this.unsubscribe?.()
  }

  render() {
    if (this.state.hasError) {
      const { className = '', heightClassName = 'h-40' } = this.props
      return (
        <div
          className={`flex ${heightClassName} w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-400 ${className}`}
        >
          {strings.reservationDetail.mapError}
        </div>
      )
    }

    return this.props.children
  }
}
