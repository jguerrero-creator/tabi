interface MenuSectionProps {
  label: string
  warning?: string
  children: React.ReactNode
}

export function MenuSection({ label, warning, children }: MenuSectionProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
        {warning && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {warning}
          </span>
        )}
      </div>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {children}
      </ul>
    </section>
  )
}
