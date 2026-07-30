// Server-side only — renders a `RecapContent` into an email subject + HTML
// body for Resend. See ../send-daily-recap.ts.
import { formatDateHeader, formatTimeInZone } from '../../src/lib/datetime.js'
import { formatDuration } from '../../src/lib/duration.js'
import { strings } from '../../src/lib/strings.js'
import type { ReservationStatus } from '../../src/types/reservation'
import type { RecapContent } from './recapContent'

export interface RecapEmail {
  subject: string
  html: string
}

// Hex equivalents of the app's emerald-500/amber-500/slate-400 3-state
// palette (src/components/menu/statusDotClasses.ts) — email HTML can't reach
// Tailwind classes, so the same semantics are reproduced as inline colors.
const STATUS_COLORS: Record<ReservationStatus, string> = {
  booked: '#10b981',
  to_book: '#f59e0b',
  decide_later: '#94a3b8',
}

export function renderRecapEmail(content: RecapContent): RecapEmail {
  const dateLabel = formatDateHeader(`${content.dateKey}T12:00:00Z`, 'UTC')
  const subject = `${content.tripName} — tomorrow, ${dateLabel}`

  const rows = buildRows(content)
  const body =
    rows.length > 0
      ? rows.map((row) => renderRow(row)).join('')
      : `<p style="color:#64748b;margin:0 0 16px;">Nothing scheduled yet — the whole day is free.</p>`

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:480px;margin:0 auto;">
  <h1 style="font-size:18px;margin:0 0 4px;">${escapeHtml(content.tripName)}</h1>
  <p style="font-size:14px;color:#64748b;margin:0 0 20px;">Tomorrow, ${escapeHtml(dateLabel)}</p>
  ${body}
</div>`.trim()

  return { subject, html }
}

type RecapRow =
  | { kind: 'reservation'; time: string; label: string; status: ReservationStatus }
  | { kind: 'free'; time: string; durationSeconds: number }

function buildRows(content: RecapContent): RecapRow[] {
  const rows: RecapRow[] = []

  if (content.dayEdges.some((edge) => edge.position === 'leading' || edge.position === 'full-day')) {
    const edge = content.dayEdges.find((e) => e.position === 'leading' || e.position === 'full-day')!
    rows.push({ kind: 'free', time: formatTimeInZone(edge.start, content.timezone), durationSeconds: edge.durationSeconds })
  }

  content.items.forEach((item, index) => {
    rows.push({
      kind: 'reservation',
      time: formatTimeInZone(item.start_at, item.start_timezone ?? content.timezone),
      label: `${strings.reservationType[item.type]} · ${item.name}`,
      status: item.status,
    })

    const next = content.freeBlocks.find((block) => block.fromReservationId === item.id)
    if (next && index < content.items.length - 1) {
      rows.push({ kind: 'free', time: formatTimeInZone(next.start, content.timezone), durationSeconds: next.durationSeconds })
    }
  })

  const trailing = content.dayEdges.find((edge) => edge.position === 'trailing')
  if (trailing) {
    rows.push({ kind: 'free', time: formatTimeInZone(trailing.start, content.timezone), durationSeconds: trailing.durationSeconds })
  }

  return rows
}

function renderRow(row: RecapRow): string {
  if (row.kind === 'free') {
    return `<div style="padding:8px 0;color:#64748b;font-size:13px;">${escapeHtml(row.time)} — free (${escapeHtml(formatDuration(row.durationSeconds))})</div>`
  }
  return `
<div style="padding:8px 0;border-left:3px solid ${STATUS_COLORS[row.status]};padding-left:10px;">
  <div style="font-size:13px;color:#64748b;">${escapeHtml(row.time)}</div>
  <div style="font-size:14px;">${escapeHtml(row.label)}</div>
</div>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
