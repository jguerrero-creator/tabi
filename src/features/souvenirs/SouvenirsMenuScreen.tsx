import { useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { strings } from '../../lib/strings'
import { useTrip } from '../trips/useTrip'
import { SouvenirChecklist } from './SouvenirChecklist'
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

  return (
    <>
      <MenuHeader title={strings.menus.souvenirs} subtitle={trip?.name} />

      <main className="px-4 py-4">
        <SouvenirChecklist
          items={items}
          currency={trip?.currency ?? ''}
          loading={tripLoading || itemsLoading}
          error={tripError || itemsError}
          onCreate={createItem}
          onUpdate={updateItem}
          onDelete={deleteItem}
        />
      </main>
    </>
  )
}
