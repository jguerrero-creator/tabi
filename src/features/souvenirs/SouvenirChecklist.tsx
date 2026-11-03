import { useId, useMemo, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { PlusIcon } from '../../components/ui/PlusIcon'
import { Spinner } from '../../components/ui/Spinner'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import { SOUVENIR_RECIPIENT_MAX_LENGTH, type SouvenirItem } from '../../types/souvenirItem'
import { SouvenirItemRow } from './SouvenirItemRow'
import type { SouvenirItemInput } from './useTripSouvenirItems'

interface SouvenirChecklistProps {
  items: SouvenirItem[]
  currency: string
  loading: boolean
  error: string | null
  onCreate: (
    input: Pick<SouvenirItemInput, 'label'> & Partial<Pick<SouvenirItemInput, 'amount' | 'recipient'>>,
  ) => Promise<unknown>
  onUpdate: (itemId: string, patch: Partial<SouvenirItemInput>) => Promise<unknown>
  onDelete: (itemId: string) => Promise<void>
}

/**
 * The souvenirs checklist (TABI-52) — shared between the standalone Souvenirs
 * screen and the Souvenirs category in the Budget accordion (TABI merge), so
 * add/rename/delete/toggle only exist in one place.
 */
export function SouvenirChecklist({ items, currency, loading, error, onCreate, onUpdate, onDelete }: SouvenirChecklistProps) {
  const newLabelFieldId = useId()
  const newAmountFieldId = useId()
  const newRecipientFieldId = useId()
  const recipientListId = useId()
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newRecipient, setNewRecipient] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const isEmpty = items.length === 0

  // Nice-to-have: suggest recipients already typed on this trip to avoid typos.
  const recipientSuggestions = useMemo(
    () =>
      Array.from(
        new Set(items.map((item) => item.recipient).filter((recipient): recipient is string => !!recipient)),
      ).sort(),
    [items],
  )

  async function handleAddItem(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = newLabel.trim()
    const trimmedAmount = newAmount.trim()
    const parsedAmount = trimmedAmount === '' ? null : Number(trimmedAmount)
    if (!trimmedLabel) return
    if (parsedAmount != null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setAddError(strings.souvenirsMenu.errorNegativeAmount)
      return
    }
    const trimmedRecipient = newRecipient.trim().slice(0, SOUVENIR_RECIPIENT_MAX_LENGTH)
    setSubmitting(true)
    setAddError(null)
    try {
      await onCreate({ label: trimmedLabel, amount: parsedAmount, recipient: trimmedRecipient === '' ? null : trimmedRecipient })
      setNewLabel('')
      setNewAmount('')
      setNewRecipient('')
      setAdding(false)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('SouvenirChecklist.handleAddItem', err)
      setAddError(strings.souvenirsMenu.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
        <Spinner />
        <p className="text-sm">{strings.souvenirsMenu.loading}</p>
      </div>
    )
  }

  if (error) {
    return <p className="py-8 text-center text-sm text-red-600">{strings.souvenirsMenu.errorLoading}</p>
  }

  return (
    <div className="space-y-2">
      {isEmpty && !adding && (
        <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-900">{strings.souvenirsMenu.emptyTitle}</p>
          <p className="text-xs text-slate-500">{strings.souvenirsMenu.emptyBody}</p>
        </div>
      )}

      {(!isEmpty || adding) && (
        <ul
          aria-label={strings.souvenirsMenu.checklistLabel}
          className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          {adding && (
            <li className="px-4 py-3">
              <form onSubmit={handleAddItem} className="space-y-2">
                <input
                  id={newLabelFieldId}
                  name={newLabelFieldId}
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  placeholder={strings.souvenirsMenu.labelPlaceholder}
                  required
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
                <input
                  id={newRecipientFieldId}
                  name={newRecipientFieldId}
                  value={newRecipient}
                  onChange={(event) => setNewRecipient(event.target.value)}
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
                  id={newAmountFieldId}
                  name={newAmountFieldId}
                  type="number"
                  step="0.01"
                  value={newAmount}
                  onChange={(event) => setNewAmount(event.target.value)}
                  placeholder={strings.souvenirsMenu.amountPlaceholder}
                  aria-label={strings.souvenirsMenu.amountFieldLabel}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
                {addError && <p className="text-xs text-red-600">{addError}</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setAdding(false)} disabled={submitting}>
                    {strings.souvenirsMenu.cancel}
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {strings.souvenirsMenu.save}
                  </Button>
                </div>
              </form>
            </li>
          )}
          {items.map((item) => (
            <SouvenirItemRow
              key={item.id}
              item={item}
              currency={currency}
              recipientSuggestions={recipientSuggestions}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      {!adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-teal-700 hover:border-teal-400 hover:bg-teal-50"
        >
          <PlusIcon className="h-4 w-4" />
          {strings.souvenirsMenu.addCta}
        </button>
      )}
    </div>
  )
}
