interface MenuSectionProps {
  label: string
  children: React.ReactNode
}

export function MenuSection({ label, children }: MenuSectionProps) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {children}
      </ul>
    </section>
  )
}
