import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { formatCurrency } from '../../lib/currency'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { SouvenirItem } from '../../types/souvenirItem'
import type { SouvenirItemInput } from './useTripSouvenirItems'

interface SouvenirItemRowProps {
  item: SouvenirItem
  currency: string
  onUpdate: (itemId: string, patch: Partial<SouvenirItemInput>) => Promise<unknown>
  onDelete: (itemId: string) => Promise<void>
}

/**
 * Directly editable inline (CLAUDE.md convention #14) — click the label to
 * edit in place, no separate detail screen for something this small.
 */
export function SouvenirItemRow({ item, currency, onUpdate, onDelete }: SouvenirItemRowProps) {
  const labelFieldId = useId()
  const amountFieldId = useId()
  const checkedFieldId = useId()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(item.label)
  const [amount, setAmount] = useState(item.amount != null ? String(item.amount) : '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = label.trim()
    const trimmedAmount = amount.trim()
    const parsedAmount = trimmedAmount === '' ? null : Number(trimmedAmount)
    if (!trimmedLabel || (parsedAmount != null && !Number.isFinite(parsedAmount))) return
    setSubmitting(true)
    setError(null)
    try {
      await onUpdate(item.id, { label: trimmedLabel, amount: parsedAmount })
      setEditing(false)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('SouvenirItemRow.handleSave', err)
      setError(strings.souvenirsMenu.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleChecked() {
    setSubmitting(true)
    setError(null)
    try {
      await onUpdate(item.id, { is_checked: !item.is_checked })
    } catch (err) {
      logClientError('SouvenirItemRow.handleToggleChecked', err)
      setError(strings.souvenirsMenu.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setSubmitting(true)
    setError(null)
    try {
      await onDelete(item.id)
    } catch (err) {
      logClientError('SouvenirItemRow.handleDelete', err)
      setError(strings.souvenirsMenu.errorGeneric)
      setSubmitting(false)
    }
  }

  if (editing) {
    return (
      <li className="px-4 py-3">
        <form onSubmit={handleSave} className="space-y-2">
          <input
            id={labelFieldId}
            name={labelFieldId}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={strings.souvenirsMenu.labelPlaceholder}
            required
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          <input
            id={amountFieldId}
            name={amountFieldId}
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={strings.souvenirsMenu.amountPlaceholder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              {strings.souvenirsMenu.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {strings.souvenirsMenu.save}
            </Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <input
        id={checkedFieldId}
        name={checkedFieldId}
        type="checkbox"
        checked={item.is_checked}
        onChange={handleToggleChecked}
        disabled={submitting}
        className="h-4 w-4 shrink-0 accent-teal-600"
        aria-label={strings.souvenirsMenu.toggleChecked}
      />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 text-left"
        aria-label={strings.souvenirsMenu.edit}
      >
        <p
          className={`truncate text-sm font-medium ${
            item.is_checked ? 'text-slate-400 line-through' : 'text-slate-900'
          }`}
        >
          {item.label}
        </p>
      </button>
      {item.amount != null ? (
        <p className="shrink-0 text-sm font-semibold text-slate-900">{formatCurrency(item.amount, currency)}</p>
      ) : (
        <p className="shrink-0 text-xs text-slate-400">{strings.souvenirsMenu.noAmountEntered}</p>
      )}
      {error && <p className="shrink-0 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={submitting}
        aria-label={strings.souvenirsMenu.delete}
        className="shrink-0 text-lg leading-none text-slate-400 hover:text-red-600"
      >
        ×
      </button>
    </li>
  )
}
