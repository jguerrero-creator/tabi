import { Component, type ErrorInfo, type ReactNode } from 'react'
import { strings } from '../../lib/strings'

interface RootErrorBoundaryProps {
  children: ReactNode
}

interface RootErrorBoundaryState {
  hasError: boolean
}

/**
 * TABI-168: MapErrorBoundary (TABI-161/167) only confines Maps SDK throws to
 * the map area. Any other uncaught render error — e.g. one surfaced by a
 * network interruption mid-session — would still unmount the whole React
 * tree to a white screen. This is the last-resort catch-all around <App>.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled render error.', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-white px-6 text-center">
          <p className="text-base font-semibold text-slate-900">{strings.appError.title}</p>
          <p className="text-sm text-slate-500">{strings.appError.body}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-teal-600 px-5 py-2 text-sm font-medium text-white"
          >
            {strings.appError.reload}
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
