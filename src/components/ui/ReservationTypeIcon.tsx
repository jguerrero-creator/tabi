import type { ReservationType } from '../../types/reservation'

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
