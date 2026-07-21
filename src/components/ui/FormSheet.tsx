import type { FormEvent, ReactNode } from 'react'
import { Button } from './Button'

interface FormSheetProps {
  title: string
  onSubmit: (event: FormEvent) => void
  onClose: () => void
  cancelLabel: string
  submitLabel: string
  submitting?: boolean
  submitDisabled?: boolean
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
  children,
}: FormSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
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
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">{children}</div>
        </form>
      </div>
    </div>
  )
}
