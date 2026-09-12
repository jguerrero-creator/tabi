import { createContext, useCallback, useContext, useRef, useState, type ReactNode, type Ref } from 'react'
import { ReservationIcon } from '../../components/ui/ReservationTypeIcon'
import { logClientError } from '../../lib/logError'
import { computeMoveCandidate, validateMove, type FreeDropTarget, type MoveCandidateDates } from '../../lib/reservationMove'
import { strings } from '../../lib/strings'
import { showErrorToast, showSavedToast } from '../../lib/toast'
import type { DayOccurrence } from '../../lib/dayOccurrences'
import type { Reservation } from '../../types/reservation'

interface DragSession {
  occurrence: DayOccurrence
}

interface DragContextValue {
  session: DragSession | null
  activeDropKey: string | null
  beginDrag: (occurrence: DayOccurrence, point: { x: number; y: number }) => void
  updateDrag: (point: { x: number; y: number }, hoveredDropKey: string | null) => void
  endDrag: (target: FreeDropTarget | null) => void
  cancelDrag: () => void
}

const DragContext = createContext<DragContextValue | null>(null)

export function useReservationDrag(): DragContextValue {
  const ctx = useContext(DragContext)
  if (!ctx) throw new Error('useReservationDrag must be used within ReservationDragProvider')
  return ctx
}

interface ReservationDragProviderProps {
  reservations: Reservation[]
  onMove: (reservationId: string, dates: MoveCandidateDates) => Promise<void>
  children: ReactNode
}

/** Owns one active Planning drag session (TABI-195) — mounted once above TripTimeline's mobile and desktop render paths so a drag can cross between them. */
export function ReservationDragProvider({ reservations, onMove, children }: ReservationDragProviderProps) {
  const [session, setSession] = useState<DragSession | null>(null)
  const [activeDropKey, setActiveDropKey] = useState<string | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const savingRef = useRef(false)

  const beginDrag = useCallback((occurrence: DayOccurrence, point: { x: number; y: number }) => {
    setSession({ occurrence })
    setActiveDropKey(null)
    const el = ghostRef.current
    if (el) el.style.transform = `translate(${point.x}px, ${point.y}px)`
  }, [])

  // Ghost position is driven imperatively (direct style write), not React
  // state, so a touchmove firing on every frame doesn't re-render the whole
  // Planning tree — only `activeDropKey` (which target, if any, highlights)
  // goes through state, and only when it actually changes.
  const updateDrag = useCallback((point: { x: number; y: number }, hoveredDropKey: string | null) => {
    const el = ghostRef.current
    if (el) el.style.transform = `translate(${point.x}px, ${point.y}px)`
    setActiveDropKey((prev) => (prev === hoveredDropKey ? prev : hoveredDropKey))
  }, [])

  const cancelDrag = useCallback(() => {
    setSession(null)
    setActiveDropKey(null)
  }, [])

  const endDrag = useCallback(
    (target: FreeDropTarget | null) => {
      // Reads the closed-over `session` directly rather than a `setSession`
      // functional updater — `endDrag` only ever runs from a touchend handler,
      // never during render, so there's no stale-closure risk here, and it
      // avoids calling showErrorToast/showSavedToast (each an immediate
      // setState in the unrelated SavedToast component) from inside a
      // setState updater, which React flags as "Cannot update a component
      // while rendering a different component."
      const current = session
      setSession(null)
      setActiveDropKey(null)
      if (!current || !target || savingRef.current) return

      const occurrence = current.occurrence
      const original = reservations.find((r) => r.id === occurrence.id) ?? occurrence
      const candidate = computeMoveCandidate(occurrence, original, target)
      if (!candidate) return // dropped back where it started — silent no-op

      const verdict = validateMove(occurrence, candidate, original, target, reservations)
      if (!verdict.ok) {
        showErrorToast(verdict.reason)
        return
      }

      savingRef.current = true
      onMove(original.id, candidate)
        .then(() => showSavedToast(strings.common.saved))
        .catch((err) => {
          logClientError('ReservationDragProvider.endDrag', err)
          showErrorToast(strings.planningDrag.saveError)
        })
        .finally(() => {
          savingRef.current = false
        })
    },
    [session, reservations, onMove],
  )

  return (
    <DragContext.Provider value={{ session, activeDropKey, beginDrag, updateDrag, endDrag, cancelDrag }}>
      {children}
      {session && <DragGhost ref={ghostRef} occurrence={session.occurrence} />}
    </DragContext.Provider>
  )
}

function DragGhost({ occurrence, ref }: { occurrence: DayOccurrence; ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      data-testid="reservation-drag-ghost"
      className="pointer-events-none fixed left-0 top-0 z-[70] -translate-x-1/2 -translate-y-[3.5rem]"
    >
      <div className="flex max-w-[220px] items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl">
        <ReservationIcon reservation={occurrence} className="h-4 w-4 shrink-0 text-white" />
        <span className="truncate">{occurrence.name}</span>
      </div>
    </div>
  )
}
