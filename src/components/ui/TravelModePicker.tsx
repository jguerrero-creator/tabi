import { strings } from '../../lib/strings'
import type { TravelMode } from '../../lib/travelTime'

const options: TravelMode[] = ['DRIVE', 'WALK', 'BICYCLE', 'TRANSIT', 'TRAIN']

interface TravelModePickerProps {
  value: TravelMode | null
  onChange: (mode: TravelMode) => void
  disabled?: boolean
}

export function TravelModePicker({ value, onChange, disabled }: TravelModePickerProps) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1.5">
      {options.map((mode) => {
        const selected = mode === value
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? 'border-teal-600 bg-teal-50 text-teal-700'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {strings.travelMode[mode]}
          </button>
        )
      })}
    </div>
  )
}
