import { strings } from '../../lib/strings'
import type { BookByBadgeInfo } from '../../features/reservations/bookByBadge'

/**
 * Small days-remaining/overdue pill for a "To book" reservation's optional book-by
 * target date — same green/red semantics as the rest of the app's "still time" vs.
 * "overdue" language, rendered next to the status pill (MenuListRow, Planning cards).
 */
export function BookByBadge({ info }: { info: BookByBadgeInfo }) {
  return (
    <span
      data-testid="book-by-badge"
      title={
        info.overdue
          ? strings.bookBy.badgeTitleOverdue(Math.abs(info.days))
          : strings.bookBy.badgeTitleDaysLeft(info.days)
      }
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
        info.overdue ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {info.overdue ? strings.bookBy.badgeOverdue(Math.abs(info.days)) : strings.bookBy.badgeDaysLeft(info.days)}
    </span>
  )
}
