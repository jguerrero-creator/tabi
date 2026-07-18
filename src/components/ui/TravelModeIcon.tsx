import type { TravelMode } from '../../lib/travelTime'

const paths: Record<TravelMode, React.ReactNode> = {
  WALK: (
    <>
      <circle cx="13" cy="4" r="1.5" />
      <path d="M10.5 21v-6.5l2-3.5 3 2 1.5 5" />
      <path d="M8.5 13.5l3-2.5 2 1" />
    </>
  ),
  DRIVE: (
    <>
      <path d="M4 16l1.2-4.2A2 2 0 0 1 7.1 10h9.8a2 2 0 0 1 1.9 1.4L20 16" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
      <circle cx="7.5" cy="20" r="1.3" />
      <circle cx="16.5" cy="20" r="1.3" />
    </>
  ),
  BICYCLE: (
    <>
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <path d="M6 17l4-9h4l4 9" />
      <path d="M10 8h3" />
    </>
  ),
  TRANSIT: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M4 10h16" />
      <circle cx="8" cy="19" r="1.3" />
      <circle cx="16" cy="19" r="1.3" />
    </>
  ),
  TRAIN: (
    <>
      <rect x="6" y="3" width="12" height="12" rx="4" />
      <path d="M6 9h12" />
      <path d="M8 19l-2-4M16 19l2-4" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
    </>
  ),
}

interface TravelModeIconProps {
  mode: TravelMode
  className?: string
}

export function TravelModeIcon({ mode, className = 'h-4 w-4' }: TravelModeIconProps) {
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
      {paths[mode]}
    </svg>
  )
}
