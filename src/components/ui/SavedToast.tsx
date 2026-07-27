import { useEffect, useState } from 'react'
import { subscribeToSavedToast } from '../../lib/toast'

const AUTO_DISMISS_MS = 2000

// TABI-184: shared "Saved" confirmation, mounted once at the app root
// (alongside ReportWidget) and driven by showSavedToast() from any save
// handler. Top-center placement keeps it clear of BottomNav and the
// ReportWidget FAB, both anchored to the bottom of the screen.
export function SavedToast() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => subscribeToSavedToast(setMessage), [])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [message])

  if (!message) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
        <CheckIcon className="h-4 w-4 text-emerald-400" />
        {message}
      </div>
    </div>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
