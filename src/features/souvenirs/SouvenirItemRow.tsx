import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { formatCurrency } from '../../lib/currency'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import { SOUVENIR_RECIPIENT_MAX_LENGTH, type SouvenirItem } from '../../types/souvenirItem'
import type { SouvenirItemInput } from './useTripSouvenirItems'

interface SouvenirItemRowProps {
  item: SouvenirItem
  currency: string
  recipientSuggestions: string[]
  onUpdate: (itemId: string, patch: Partial<SouvenirItemInput>) => Promise<unknown>
  onDelete: (itemId: string) => Promise<void>
}

/**
 * Directly editable inline (CLAUDE.md convention #14) — click anywhere on the
 * row's content (name, recipient or amount) to edit all three in place, no
 * separate detail screen for something this small.
 */
export function SouvenirItemRow({ item, currency, recipientSuggestions, onUpdate, onDelete }: SouvenirItemRowProps) {
  const labelFieldId = useId()
  const amountFieldId = useId()
  const recipientFieldId = useId()
  const recipientListId = useId()
  const checkedFieldId = useId()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(item.label)
  const [amount, setAmount] = useState(item.amount != null ? String(item.amount) : '')
  const [recipient, setRecipient] = useState(item.recipient ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEditing() {
    setLabel(item.label)
    setAmount(item.amount != null ? String(item.amount) : '')
    setRecipient(item.recipient ?? '')
    setError(null)
    setEditing(true)
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = label.trim()
    const trimmedAmount = amount.trim()
    const parsedAmount = trimmedAmount === '' ? null : Number(trimmedAmount)
    if (!trimmedLabel) return
    if (parsedAmount != null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setError(strings.souvenirsMenu.errorNegativeAmount)
      return
    }
    const trimmedRecipient = recipient.trim().slice(0, SOUVENIR_RECIPIENT_MAX_LENGTH)
    setSubmitting(true)
    setError(null)
    try {
      await onUpdate(item.id, {
        label: trimmedLabel,
        amount: parsedAmount,
        recipient: trimmedRecipient === '' ? null : trimmedRecipient,
      })
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
            id={recipientFieldId}
            name={recipientFieldId}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder={strings.souvenirsMenu.recipientPlaceholder}
            aria-label={strings.souvenirsMenu.recipientFieldLabel}
            maxLength={SOUVENIR_RECIPIENT_MAX_LENGTH}
            list={recipientSuggestions.length > 0 ? recipientListId : undefined}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          {recipientSuggestions.length > 0 && (
            <datalist id={recipientListId}>
              {recipientSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <input
            id={amountFieldId}
            name={amountFieldId}
            type="number"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={strings.souvenirsMenu.amountPlaceholder}
            aria-label={strings.souvenirsMenu.amountFieldLabel}
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
    <li className="flex items-start gap-3 px-4 py-3">
      <input
        id={checkedFieldId}
        name={checkedFieldId}
        type="checkbox"
        checked={item.is_checked}
        onChange={handleToggleChecked}
        disabled={submitting}
        className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
        aria-label={strings.souvenirsMenu.toggleChecked}
      />
      <button type="button" onClick={openEditing} className="min-w-0 flex-1 text-left" aria-label={strings.souvenirsMenu.edit}>
        <p
          className={`truncate text-sm font-medium ${
            item.is_checked ? 'text-slate-400 line-through' : 'text-slate-900'
          }`}
        >
          {item.label}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          {item.recipient && (
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {strings.souvenirsMenu.recipientPrefix} {item.recipient}
            </span>
          )}
          <span
            className={`shrink-0 text-xs ${item.recipient ? '' : 'ml-auto'} ${
              item.amount != null ? 'font-semibold text-slate-900' : 'text-slate-400'
            }`}
          >
            {item.amount != null ? formatCurrency(item.amount, currency) : strings.souvenirsMenu.noAmountEntered}
          </span>
        </div>
      </button>
      {error && <p className="shrink-0 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={submitting}
        aria-label={strings.souvenirsMenu.delete}
        className="mt-0.5 shrink-0 text-lg leading-none text-slate-400 hover:text-red-600"
      >
        ×
      </button>
    </li>
  )
}
