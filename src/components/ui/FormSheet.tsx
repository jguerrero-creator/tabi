import { useEffect, type FormEvent, type ReactNode } from 'react'
import { Button } from './Button'

interface FormSheetProps {
  title: string
  onSubmit: (event: FormEvent) => void
  onClose: () => void
  cancelLabel: string
  submitLabel: string
  submitting?: boolean
  submitDisabled?: boolean
  /** 'large' covers almost the full viewport instead of the standard small sheet — desktop note editor only (Backlog: grande fenêtre sur desktop). */
  size?: 'default' | 'large'
  /**
   * Opt-in only. Every other FormSheet caller deliberately has no
   * Escape/backdrop dismiss (see AddVehicleRentalLegSheet) so a mid-save
   * Escape can't unmount a sheet with a request still in flight — the
   * desktop note editor passes this explicitly since it has no such
   * in-flight risk and the Backlog item asks for it.
   */
  closeOnEscape?: boolean
  children: ReactNode
}

// TABI-145: Cancel/Save stay in this header, outside the overflow-y-auto body below,
// so they're always reachable without scrolling the form — not just for long forms today,
// but for any fields added later.
export function FormSheet({
  title,
  onSubmit,
  onClose,
  cancelLabel,
  submitLabel,
  submitting = false,
  submitDisabled = false,
  size = 'default',
  closeOnEscape = false,
  children,
}: FormSheetProps) {
  useEffect(() => {
    if (!closeOnEscape) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeOnEscape, onClose])

  const sizeClasses = size === 'large' ? 'h-[92vh] max-w-4xl sm:h-[88vh]' : 'max-h-[90vh] max-w-sm'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className={`flex w-full flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl ${sizeClasses}`}>
        {/* TABI-159: noValidate so native HTML5 required-field popups never preempt our custom error messages */}
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                {cancelLabel}
              </Button>
              <Button type="submit" disabled={submitting || submitDisabled}>
                {submitLabel}
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto px-6 py-4">{children}</div>
        </form>
      </div>
    </div>
  )
}
