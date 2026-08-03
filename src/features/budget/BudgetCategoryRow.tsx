import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { formatCurrency } from '../../lib/currency'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import type { BudgetCategory } from '../../types/budgetCategory'
import type { BudgetCategoryInput } from './useTripBudgetCategories'

interface BudgetCategoryRowProps {
  category: BudgetCategory
  currency: string
  onUpdate: (categoryId: string, patch: Partial<BudgetCategoryInput>) => Promise<unknown>
  onDelete: (categoryId: string) => Promise<void>
}

/**
 * Directly editable inline (TABI-57 / CLAUDE.md convention #14) — click the
 * label to edit in place, no separate detail screen for something this small.
 */
export function BudgetCategoryRow({ category, currency, onUpdate, onDelete }: BudgetCategoryRowProps) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(category.label)
  const [amount, setAmount] = useState(String(category.amount))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = label.trim()
    const parsedAmount = Number(amount)
    if (!trimmedLabel || !Number.isFinite(parsedAmount)) return
    setSubmitting(true)
    setError(null)
    try {
      await onUpdate(category.id, { label: trimmedLabel, amount: parsedAmount })
      setEditing(false)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('BudgetCategoryRow.handleSave', err)
      setError(strings.budgetMenu.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setSubmitting(true)
    setError(null)
    try {
      await onDelete(category.id)
    } catch (err) {
      logClientError('BudgetCategoryRow.handleDelete', err)
      setError(strings.budgetMenu.errorGeneric)
      setSubmitting(false)
    }
  }

  if (editing) {
    return (
      <li className="px-4 py-3">
        <form onSubmit={handleSave} className="space-y-2">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={strings.budgetMenu.labelPlaceholder}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={strings.budgetMenu.amountPlaceholder}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={submitting}>
              {strings.budgetMenu.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {strings.budgetMenu.save}
            </Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 text-left"
        aria-label={strings.budgetMenu.edit}
      >
        <p className="truncate text-sm font-medium text-slate-900">{category.label}</p>
      </button>
      <p className="shrink-0 text-sm font-semibold text-slate-900">{formatCurrency(category.amount, currency)}</p>
      {error && <p className="shrink-0 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleDelete}
        disabled={submitting}
        aria-label={strings.budgetMenu.delete}
        className="shrink-0 text-lg leading-none text-slate-400 hover:text-red-600"
      >
        ×
      </button>
    </li>
  )
}
