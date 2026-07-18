import { formatDateHeader, localDateKey } from '../../lib/datetime'

export interface DateGroup<T> {
  dateKey: string
  label: string
  items: T[]
}

const UNSCHEDULED_KEY = '￿'

export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => { at: string | null; timezone: string | null },
  options?: { unscheduledLabel?: string },
): DateGroup<T>[] {
  const groups = new Map<string, DateGroup<T>>()

  for (const item of items) {
    const { at, timezone } = getDate(item)
    const dateKey = at ? localDateKey(at, timezone) : UNSCHEDULED_KEY
    let group = groups.get(dateKey)
    if (!group) {
      const label = at ? formatDateHeader(at, timezone) : (options?.unscheduledLabel ?? 'Unscheduled')
      group = { dateKey, label, items: [] }
      groups.set(dateKey, group)
    }
    group.items.push(item)
  }

  return Array.from(groups.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}
