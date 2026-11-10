import { Fragment, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MenuHeader } from '../../components/menu/MenuHeader'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { SubtypeFilterPills } from '../../components/menu/SubtypeFilterPills'
import { groupByDate } from '../../components/menu/groupByDate'
import { nestOverlappingReservations } from '../../components/menu/nestOverlaps'
import { Spinner } from '../../components/ui/Spinner'
import { useTrip } from '../trips/useTrip'
import { AddReservationModal } from '../reservations/AddReservationModal'
import { useCreateReservation } from '../reservations/useCreateReservation'
import { useReservationsByType } from '../reservations/useReservationsByType'
import { useTripChecklistItemNames } from '../reservations/useTripChecklistItemNames'
import { strings } from '../../lib/strings'
import type { MealSubtype, Reservation } from '../../types/reservation'

// Step 5 (Meal plan): mirrors TransportMenuScreen's structure — the plain SubtypeFilterPills
// + shared AddReservationModal flow, not ActivitiesMenuScreen's search-first one (that flow
// is deliberately left alone, see the Step 4a inventory note on its own e2e coupling).
const MEAL_SUBTYPE_OPTIONS = Object.entries(strings.addReservation.activitySubtypes).map(([value, label]) => ({
  value: value as MealSubtype,
  label,
}))

export function MealsMenuScreen() {
  const { tripId } = useParams<{ tripId: string }>()
  const { trip, loading: tripLoading, error: tripError } = useTrip(tripId ?? '')
  const {
    reservations,
    loading: reservationsLoading,
    error: reservationsError,
    refetch: refetchReservations,
  } = useReservationsByType(tripId ?? '', 'meal')
  const { namesByReservationId: checklistItemNamesByReservationId } = useTripChecklistItemNames(tripId ?? '')
  const { createReservation } = useCreateReservation(tripId ?? '')
  const [showAddModal, setShowAddModal] = useState(false)
  const [subtypeFilter, setSubtypeFilter] = useState<Set<MealSubtype>>(new Set())

  const loading = tripLoading || reservationsLoading
  const error = tripError || reservationsError

  const toggleSubtypeFilter = (subtype: MealSubtype) => {
    setSubtypeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(subtype)) next.delete(subtype)
      else next.add(subtype)
      return next
    })
  }

  const filteredReservations = useMemo(() => {
    if (subtypeFilter.size === 0) return reservations
    return reservations.filter((reservation) => reservation.meal_subtype && subtypeFilter.has(reservation.meal_subtype))
  }, [reservations, subtypeFilter])

  const { nestedIds, childrenByMainId } = useMemo(
    () => nestOverlappingReservations(filteredReservations),
    [filteredReservations],
  )
  const groups = useMemo(
    () =>
      groupByDate(
        filteredReservations.filter((reservation) => !nestedIds.has(reservation.id)),
        (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
        { unscheduledLabel: strings.mealsMenu.unscheduledLabel },
      ),
    [filteredReservations, nestedIds],
  )

  function secondaryLabel(reservation: Reservation): string | null {
    return reservation.meal_subtype === 'checklist'
      ? checklistNamesLabel(checklistItemNamesByReservationId.get(reservation.id) ?? [])
      : null
  }

  return (
    <>
      <MenuHeader
        title={strings.mealsMenu.title}
        subtitle={trip?.name}
        count={reservations.length}
        addLabel={strings.mealsMenu.addCta}
        onAdd={() => setShowAddModal(true)}
      />

      <main className="px-4 py-4">
        {loading && (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-500">
            <Spinner />
            <p className="text-sm">{strings.mealsMenu.loading}</p>
          </div>
        )}

        {!loading && error && <p className="py-16 text-center text-sm text-red-600">{strings.mealsMenu.errorLoading}</p>}

        {!loading && !error && reservations.length > 0 && (
          <SubtypeFilterPills options={MEAL_SUBTYPE_OPTIONS} selected={subtypeFilter} onToggle={toggleSubtypeFilter} />
        )}

        {!loading && !error && reservations.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.mealsMenu.emptyTitle}</h2>
            <p className="text-sm text-slate-500">{strings.mealsMenu.emptyBody}</p>
          </div>
        )}

        {!loading && !error && reservations.length > 0 && groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <h2 className="text-base font-medium text-slate-900">{strings.mealsMenu.noFilterMatchTitle}</h2>
            <p className="text-sm text-slate-500">{strings.mealsMenu.noFilterMatchBody}</p>
          </div>
        )}

        {!loading && !error && groups.length > 0 && (
          <div className="space-y-5">
            {groups.map((group) => (
              <MenuSection key={group.dateKey} label={group.label}>
                {group.items.map((reservation) => (
                  <Fragment key={reservation.id}>
                    <MenuListRow
                      to={`/reservations/${reservation.id}`}
                      type={reservation.type}
                      title={reservation.name}
                      status={reservation.status}
                      secondaryLabel={secondaryLabel(reservation)}
                      rating={placeRating(reservation)}
                      mealSubtype={reservation.meal_subtype}
                    />
                    {(childrenByMainId.get(reservation.id) ?? []).map((nested) => (
                      <MenuListRow
                        key={nested.id}
                        to={`/reservations/${nested.id}`}
                        type={nested.type}
                        title={nested.name}
                        status={nested.status}
                        secondaryLabel={secondaryLabel(nested)}
                        nested
                        overlapBadge={strings.common.overlapBadge}
                        rating={placeRating(nested)}
                        mealSubtype={nested.meal_subtype}
                      />
                    ))}
                  </Fragment>
                ))}
              </MenuSection>
            ))}
          </div>
        )}
      </main>

      {showAddModal && (
        <AddReservationModal
          tripId={tripId ?? ''}
          defaultType="meal"
          onClose={() => setShowAddModal(false)}
          onCreate={async (input) => {
            const created = await createReservation(input)
            await refetchReservations()
            return created
          }}
        />
      )}
    </>
  )
}

// Same full-list treatment as the Planning card and ActivitiesMenuScreen's own
// checklistNamesLabel (Backlog: "Carte Planning checklist : afficher la liste complète
// des noms de lieux") — comma-joined since this row's secondaryLabel is single-line.
function checklistNamesLabel(items: { id: string; name: string }[]): string {
  return items.length === 0 ? strings.checklistItems.itemCountEmpty : items.map((item) => item.name).join(', ')
}

// TABI-14: the Google rating snapshot taken at bookmark time, if any — place_* columns
// are written unconditionally regardless of reservation type.
function placeRating(reservation: Reservation): { rating: number; userRatingsTotal: number | null } | null {
  return reservation.place_rating != null
    ? { rating: reservation.place_rating, userRatingsTotal: reservation.place_user_ratings_total }
    : null
}
