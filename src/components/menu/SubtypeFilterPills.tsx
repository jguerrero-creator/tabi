// TABI-207: minimal subtype filter for Stay/Transport menu screens. No filter UI
// pattern existed elsewhere in the app before this — kept intentionally simple
// (toggle chips, session-local state) since real usage may reshape this later.
export function SubtypeFilterPills<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: { value: T; label: string }[]
  selected: Set<T>
  onToggle: (value: T) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected.has(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(option.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isSelected
                ? 'border-teal-600 bg-teal-50 text-teal-700'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
