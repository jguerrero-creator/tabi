interface DayTabsProps {
  days: { key: string; label: string }[]
  selectedKey: string
  onSelect: (key: string) => void
}

export function DayTabs({ days, selectedKey, onSelect }: DayTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {days.map((day) => {
        const selected = day.key === selectedKey
        return (
          <button
            key={day.key}
            type="button"
            onClick={() => onSelect(day.key)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
              selected
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {day.label}
          </button>
        )
      })}
    </div>
  )
}
