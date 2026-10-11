/**
 * Shared "+" glyph for round add buttons (Bugs: "Le + du bouton rond d'ajout
 * sur un bloc de temps libre n'est pas centré dans son cercle"). A plain "+"
 * text character is never centered by construction — a font's glyph ink
 * isn't symmetric around the line box's visual middle, so it drifts off­
 * center differently per font/size/zoom. Two straight lines in a fixed
 * viewBox, flex-centered in the button, are centered by construction instead.
 */
export function PlusIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
