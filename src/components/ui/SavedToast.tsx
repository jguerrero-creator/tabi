import { useEffect, useState } from 'react'
import { subscribeToSavedToast, type ToastVariant } from '../../lib/toast'

const AUTO_DISMISS_MS = 2000

// TABI-184: shared "Saved" confirmation, mounted once at the app root
// (alongside ReportWidget) and driven by showSavedToast() from any save
// handler. Top-center placement keeps it clear of BottomNav and the
// ReportWidget FAB, both anchored to the bottom of the screen. Also carries
// showErrorToast()'s red/error variant (TABI-195: a rejected Planning
// drag-and-drop move) rather than a second, screen-specific toast.
export function SavedToast() {
  const [toast, setToast] = useState<{ message: string; variant: ToastVariant } | null>(null)

  useEffect(() => subscribeToSavedToast((message, variant) => setToast({ message, variant })), [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast])

  if (!toast) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
        {toast.variant === 'error' ? (
          <ErrorIcon className="h-4 w-4 text-red-400" />
        ) : (
          <CheckIcon className="h-4 w-4 text-emerald-400" />
        )}
        {toast.message}
      </div>
    </div>
  )
}

function ErrorIcon({ className }: { className?: string }) {
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
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
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
