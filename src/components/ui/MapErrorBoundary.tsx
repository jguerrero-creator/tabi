import { Component, type ErrorInfo, type ReactNode } from 'react'
import { strings } from '../../lib/strings'

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
 */
export class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Map failed to render.', error, errorInfo)
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
