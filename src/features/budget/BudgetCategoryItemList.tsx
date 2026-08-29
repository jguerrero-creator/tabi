import { useMemo } from 'react'
import { MenuListRow } from '../../components/menu/MenuListRow'
import { MenuSection } from '../../components/menu/MenuSection'
import { groupByDate } from '../../components/menu/groupByDate'
import { formatCurrency } from '../../lib/currency'
import { strings } from '../../lib/strings'
import type { Reservation, ReservationType } from '../../types/reservation'

interface BudgetCategoryItemListProps {
  type: ReservationType
  reservations: Reservation[]
  currency: string
  travelerCount: number
}

/**
 * Shared item list (name/date/cost) for a budget category — rendered inline
 * under an expanded category row on Budget (TABI accordion refinement).
 */
export function BudgetCategoryItemList({ type, reservations, currency, travelerCount }: BudgetCategoryItemListProps) {
  const groups = useMemo(
    () =>
      groupByDate(
        reservations,
        (reservation) => ({ at: reservation.start_at, timezone: reservation.start_timezone }),
        { unscheduledLabel: strings.budgetCategoryDetail.unscheduledLabel },
      ),
    [reservations],
  )

  function costLabel(reservation: Reservation): React.ReactNode {
    if (reservation.price_amount == null) {
      return <span className="text-xs text-slate-400">{strings.budgetMenu.noPriceEntered}</span>
    }
    const amount = formatCurrency(reservation.price_amount, reservation.price_currency ?? currency)
    if (type !== 'stay' || travelerCount <= 1) {
      return <span className="text-sm font-semibold text-slate-900">{amount}</span>
    }
    const perPerson = formatCurrency(reservation.price_amount / travelerCount, reservation.price_currency ?? currency)
    return (
      <span className="text-sm font-semibold text-slate-900">
        {amount}
        <span className="ml-1 font-normal text-slate-500">· {strings.budgetMenu.perPersonAmount(perPerson)}</span>
      </span>
    )
  }

  return (
    <div className="space-y-3 bg-slate-50 px-2 py-3">
      {groups.map((group) => (
        <MenuSection key={group.dateKey} label={group.label}>
          {group.items.map((reservation) => (
            <MenuListRow
              key={reservation.id}
              to={`/reservations/${reservation.id}`}
              type={reservation.type}
              title={reservation.name}
              status={reservation.status}
              staySubtype={reservation.stay_subtype}
              transportSubtype={reservation.transport_subtype}
              trailing={costLabel(reservation)}
            />
          ))}
        </MenuSection>
      ))}
    </div>
  )
}
