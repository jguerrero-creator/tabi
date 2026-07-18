import { formatDuration } from '../../lib/duration'
import { MIN_FREE_SECONDS_TO_SHOW } from '../../lib/freeTimeBlocks'
import { strings } from '../../lib/strings'

interface FreeTimeRowProps {
  durationSeconds: number
  travelSeconds: number
  tooLongTravel: boolean
}

export function FreeTimeRow({ durationSeconds, travelSeconds, tooLongTravel }: FreeTimeRowProps) {
  const isTight = durationSeconds < 0
  if (!isTight && !tooLongTravel && durationSeconds < MIN_FREE_SECONDS_TO_SHOW) return null

  const isWarning = isTight || tooLongTravel
  return (
    <li className={`px-4 py-2 text-xs font-medium ${isWarning ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-500'}`}>
      {isTight
        ? strings.planning.tightConnection(formatDuration(Math.abs(durationSeconds)))
        : tooLongTravel
          ? strings.planning.longTravel(formatDuration(travelSeconds))
          : strings.planning.freeTime(formatDuration(durationSeconds))}
    </li>
  )
}
