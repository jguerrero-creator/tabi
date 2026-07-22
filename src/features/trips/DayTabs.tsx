import { useEffect, useRef, useState } from 'react'
import { statusTextClasses } from '../../components/menu/statusDotClasses'
import { ReservationTypeIcon, VehicleRentalIcon } from '../../components/ui/ReservationTypeIcon'
import { strings } from '../../lib/strings'
import type { ReservationStatus } from '../../types/reservation'

export interface DayTab {
  key: string
  label: string
  /** The Stay reservation's status covering this day, or null if no accommodation is booked (TABI-143). */
  stayStatus: ReservationStatus | null
  /** The at-disposal vehicle rental's status covering this day, or null if none (TABI-143, added 20/07). */
  vehicleRentalStatus: ReservationStatus | null
  /** Total reservations + activities (+ manual blocks, once TABI-143's dependency exists) planned this day. */
  itemCount: number
}

interface DayTabsProps {
  days: DayTab[]
  selectedKey: string
  onSelect: (key: string) => void
}

export function DayTabs({ days, selectedKey, onSelect }: DayTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // Plain horizontal overflow-x-auto isn't discoverable enough on its own
  // (TABI-139) — a fading chevron on whichever edge still has hidden pills
  // signals there's more to scroll to, and disappears once that edge is reached.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const updateEdges = () => {
      setCanScrollLeft(el.scrollLeft > 0)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }

    updateEdges()
    el.addEventListener('scroll', updateEdges)
    const resizeObserver = new ResizeObserver(updateEdges)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener('scroll', updateEdges)
      resizeObserver.disconnect()
    }
  }, [days])

  return (
    <div className="relative">
      <div ref={scrollRef} data-testid="day-tabs-scroll" className="flex gap-2 overflow-x-auto pb-1">
        {days.map((day) => {
          const selected = day.key === selectedKey
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => onSelect(day.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                selected
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>{day.label}</span>
              {day.stayStatus && (
                <span title={strings.planning.dayPillStayStatus(day.stayStatus)} className="shrink-0">
                  <ReservationTypeIcon type="stay" className={`h-3.5 w-3.5 ${statusTextClasses[day.stayStatus]}`} />
                </span>
              )}
              {day.vehicleRentalStatus && (
                <span
                  title={strings.planning.dayPillVehicleRentalStatus(day.vehicleRentalStatus)}
                  className="shrink-0"
                >
                  <VehicleRentalIcon className={`h-3.5 w-3.5 ${statusTextClasses[day.vehicleRentalStatus]}`} />
                </span>
              )}
              {day.itemCount > 0 && (
                <span
                  title={strings.planning.dayPillItemCount(day.itemCount)}
                  className={`flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    selected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {day.itemCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {canScrollLeft && (
        <div
          aria-hidden="true"
          data-testid="day-tabs-chevron-left"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center bg-gradient-to-r from-slate-50 to-transparent pb-1"
        >
          <ScrollEdgeChevron direction="left" />
        </div>
      )}

      {canScrollRight && (
        <div
          aria-hidden="true"
          data-testid="day-tabs-chevron-right"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end bg-gradient-to-l from-slate-50 to-transparent pb-1"
        >
          <ScrollEdgeChevron direction="right" />
        </div>
      )}
    </div>
  )
}

function ScrollEdgeChevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-slate-400 opacity-70"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}
