import { strings } from '../../lib/strings'
import type { ReservationStatus } from '../../types/reservation'

const options: ReservationStatus[] = ['booked', 'to_book', 'decide_later']

const dotClasses: Record<ReservationStatus, string> = {
  booked: 'bg-emerald-500',
  to_book: 'bg-amber-500',
  decide_later: 'bg-slate-400',
}

interface StatusPickerProps {
  value: ReservationStatus
  onChange: (status: ReservationStatus) => void
  disabled?: boolean
}

export function StatusPicker({ value, onChange, disabled }: StatusPickerProps) {
  return (
    <div role="radiogroup" className="flex gap-2">
      {options.map((status) => {
        const selected = status === value
        return (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(status)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? 'border-teal-600 bg-teal-50 text-teal-700'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses[status]}`} />
            {strings.status[status]}
          </button>
        )
      })}
    </div>
  )
}
