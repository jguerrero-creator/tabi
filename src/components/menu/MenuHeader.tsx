import { useNavigate } from 'react-router-dom'
import { strings } from '../../lib/strings'

interface MenuHeaderProps {
  title: string
  subtitle?: string | null
  count?: number
  addLabel: string
  onAdd: () => void
}

export function MenuHeader({ title, subtitle, count, addLabel, onAdd }: MenuHeaderProps) {
  const navigate = useNavigate()

  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label={strings.common.back}
        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
      >
        ←
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold text-slate-900">
          {title}
          {typeof count === 'number' && count > 0 && (
            <span className="ml-1.5 text-sm font-normal text-slate-400">({count})</span>
          )}
        </h1>
        {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onAdd}
        aria-label={addLabel}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xl leading-none text-white hover:bg-teal-700"
      >
        +
      </button>
    </header>
  )
}
