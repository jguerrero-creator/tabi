import { Button } from './Button'

interface ConfirmDialogProps {
  title: string
  message: string
  noteLabel?: string
  notePlaceholder?: string
  note?: string
  onNoteChange?: (value: string) => void
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
  confirming?: boolean
}

export function ConfirmDialog({
  title,
  message,
  noteLabel,
  notePlaceholder,
  note,
  onNoteChange,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirming = false,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-600">{message}</p>

        {noteLabel && (
          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{noteLabel}</span>
            <textarea
              value={note}
              onChange={(event) => onNoteChange?.(event.target.value)}
              placeholder={notePlaceholder}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            />
          </label>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={confirming}>
            {cancelLabel}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={confirming}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
