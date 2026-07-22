import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { strings } from '../../lib/strings'
import type { TripDayNote } from '../../types/dayNote'

interface DayNoteProps {
  dayKey: string
  note: TripDayNote | null
  onSave: (note: string) => Promise<void>
  onClear: () => Promise<void>
}

/**
 * Lightweight per-day note widget (TABI-56) — a free-form note attachable to
 * a specific day, independent of any reservation. Mirrors DayPlannedLocation's
 * collapsed-pill / inline-edit shape.
 */
export function DayNote({ dayKey, note, onSave, onClear }: DayNoteProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEditing() {
    setText(note?.note ?? '')
    setError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setError(null)
  }

  async function handleSave() {
    if (!text.trim()) return
    setError(null)
    setSaving(true)
    try {
      await onSave(text.trim())
      setEditing(false)
    } catch {
      setError(strings.dayNote.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    setError(null)
    try {
      await onClear()
      setEditing(false)
    } catch {
      setError(strings.dayNote.errorGeneric)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return note ? (
      <button
        type="button"
        onClick={startEditing}
        className="flex max-w-full items-center gap-1.5 truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
      >
        <span aria-hidden="true">📝</span>
        <span className="truncate">{note.note}</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={startEditing}
        className="rounded-full px-3 py-1 text-xs font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        {strings.dayNote.addCta}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <label htmlFor={`day-note-${dayKey}`} className="block text-xs font-medium text-slate-700">
        {strings.dayNote.label}
      </label>
      <textarea
        id={`day-note-${dayKey}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={strings.dayNote.placeholder}
        rows={3}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
      />
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        {note ? (
          <Button
            type="button"
            variant="secondary"
            onClick={handleRemove}
            disabled={saving}
            className="text-red-600 hover:bg-red-50"
          >
            {strings.dayNote.remove}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={cancelEditing} disabled={saving}>
            {strings.dayNote.cancel}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || !text.trim()}>
            {strings.dayNote.save}
          </Button>
        </div>
      </div>
    </div>
  )
}
