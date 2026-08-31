import type { ReservationType, StaySubtype, TransportSubtype } from '../../types/reservation'

/**
 * Type-identity colors (TABI-217) — distinct from the 3-state booking-status
 * palette (statusDotClasses: emerald/amber/slate). Rose (not raw `red`) avoids
 * reading as an error state, since `red` is used app-wide for error text/banners;
 * `yellow` (not `amber`) avoids matching the "to book" status color.
 */
export const reservationTypeBadgeClasses: Record<ReservationType, string> = {
  // yellow-700, not -600: Tailwind's yellow-600 (#CA8A04) sits almost on the
  // same hue as the "to book" status dot (amber-500, #F59E0B) — measured near-
  // identical on a rendered to-book Transport row. The darker -700 keeps the
  // same yellow family but is dark/muted enough to read as clearly distinct
  // from that bright orange dot.
  transport: 'bg-yellow-50 text-yellow-700',
  stay: 'bg-rose-50 text-rose-600',
  activity: 'bg-blue-50 text-blue-600',
}

/** Same per-type palette as `reservationTypeBadgeClasses`, as a bare icon/text color for un-badged icons. */
export const reservationTypeTextClasses: Record<ReservationType, string> = {
  transport: 'text-yellow-700',
  stay: 'text-rose-600',
  activity: 'text-blue-600',
}

const paths: Record<ReservationType, React.ReactNode> = {
  stay: (
    <>
      <path d="M2 17V6" />
      <path d="M2 10h19a1 1 0 0 1 1 1v6" />
      <path d="M2 15h20" />
      <path d="M6 10V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ),
  transport: (
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.4 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  ),
  activity: (
    <>
      <path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
}

interface ReservationTypeIconProps {
  type: ReservationType
  className?: string
}

export function ReservationTypeIcon({ type, className = 'h-5 w-5' }: ReservationTypeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  )
}

/** Distinct glyphs per Stay sub-type (TABI-130) — 'hotel'/'other'/unset fall back to the generic stay icon. */
const staySubtypePaths: Partial<Record<StaySubtype, React.ReactNode>> = {
  camping: (
    <>
      <path d="M3 20 12 4l9 16" />
      <path d="M8 20l4-7 4 7" />
    </>
  ),
  airbnb: (
    <>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  ryokan: (
    <>
      <path d="M4 8h16" />
      <path d="M4 8v12h16V8" />
      <path d="M9 8v12M15 8v12" />
    </>
  ),
}

export function StaySubtypeIcon({
  subtype,
  className = 'h-5 w-5',
}: {
  subtype?: StaySubtype | null
  className?: string
}) {
  const path = (subtype && staySubtypePaths[subtype]) || paths.stay
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

interface ReservationIconInput {
  type: ReservationType
  stay_subtype?: StaySubtype | null
  transport_subtype?: TransportSubtype | null
}

/** Single place picking the right glyph for a reservation, sub-type included (TABI-130). */
export function ReservationIcon({
  reservation,
  className = 'h-5 w-5',
}: {
  reservation: ReservationIconInput
  className?: string
}) {
  if (reservation.type === 'stay') {
    return <StaySubtypeIcon subtype={reservation.stay_subtype} className={className} />
  }
  if (reservation.type === 'transport' && reservation.transport_subtype === 'at_disposal') {
    return <VehicleRentalIcon className={className} />
  }
  return <ReservationTypeIcon type={reservation.type} className={className} />
}

/** Distinct from the generic `transport` (plane) icon — flags a day covered by an at-disposal vehicle rental (TABI-143). */
export function VehicleRentalIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 16V9.5a1 1 0 0 1 .6-.9L6 7.5l2-3.5h8l2 3.5 2.4 1.1a1 1 0 0 1 .6.9V16" />
      <path d="M3 16h18" />
      <circle cx="7.5" cy="16" r="1.75" />
      <circle cx="16.5" cy="16" r="1.75" />
    </svg>
  )
}

/** Flags a Transport leg's arrival day as "probable jetlag" (3+ hour timezone offset shift, TABI-66). */
export function JetlagIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18" fill="currentColor" stroke="none" />
      <path d="M12 7v5l3 3" />
    </svg>
  )
}
