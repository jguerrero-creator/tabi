import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuSection } from '../../components/menu/MenuSection'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'
import { showSavedToast } from '../../lib/toast'
import { useTrip } from '../trips/useTrip'
import { SouvenirItemRow } from './SouvenirItemRow'
import { useTripSouvenirItems } from './useTripSouvenirItems'

export function SouvenirsMenuScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    items,
    loading: itemsLoading,
    error: itemsError,
    createItem,
    updateItem,
    deleteItem,
  } = useTripSouvenirItems(tripId ?? '')

  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const loading = tripLoading || itemsLoading
  const error = tripError || itemsError
  const isEmpty = items.length === 0

  async function handleAddItem(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = newLabel.trim()
    if (!trimmedLabel) return
    setSubmitting(true)
    setAddError(null)
    try {
      await createItem({ label: trimmedLabel })
      setNewLabel('')
      setAdding(false)
      showSavedToast(strings.common.saved)
    } catch (err) {
      logClientError('SouvenirsMenuScreen.handleAddItem', err)
      setAddError(strings.souvenirsMenu.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <MenuHeader
        title={strings.menus.souvenirs}
        subtitle={trip?.name}
        addLabel={strings.souvenirsMenu.addCta}
        onAdd={() => setAdding(true)}
      />

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.souvenirsMenu.loading}</p>
          </div>
        )}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-red-600">{strings.souvenirsMenu.errorLoading}</p>
        )}

        {!loading && !error && isEmpty && !adding && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.souvenirsMenu.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.souvenirsMenu.emptyBody}</p>
          </div>
        )}

        {!loading && !error && (!isEmpty || adding) && (
          <MenuSection label={strings.menus.souvenirs}>
            {adding && (
              <li className="px-4 py-3">
                <form onSubmit={handleAddItem} className="space-y-2">
                  <input
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    placeholder={strings.souvenirsMenu.labelPlaceholder}
                    required
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                  {addError && <p className="text-xs text-red-600">{addError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setAdding(false)}
                      disabled={submitting}
                    >
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
              <SouvenirItemRow key={item.id} item={item} onUpdate={updateItem} onDelete={deleteItem} />
            ))}
          </MenuSection>
        )}
      </main>
    </>
  )
}
