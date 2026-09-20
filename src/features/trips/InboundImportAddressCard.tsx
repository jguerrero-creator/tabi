import { useState } from 'react'
import { logClientError } from '../../lib/logError'
import { strings } from '../../lib/strings'

const inboundDomain = import.meta.env.VITE_RESEND_INBOUND_DOMAIN as string | undefined

interface InboundImportAddressCardProps {
  localPart: string | null
}

// TABI: shows the trip's dedicated forward-a-confirmation-here address (generated at
// trip creation, see useTrips.ts). No per-trip settings screen exists to put this on
// (nothing in this codebase has one yet — see TABI-40's identical gap for the
// reminder-email toggle), so like every other trip-level info block today, it lives
// directly on Overview rather than gating this feature on building one.
export function InboundImportAddressCard({ localPart }: InboundImportAddressCardProps) {
  const [copied, setCopied] = useState(false)

  if (!localPart || !inboundDomain) return null
  const address = `${localPart}@${inboundDomain}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      logClientError('InboundImportAddressCard.handleCopy', err)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {strings.inboundImportAddress.label}
      </p>
      <p className="mt-1 text-xs text-slate-500">{strings.inboundImportAddress.description}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-2 py-1.5 text-xs text-slate-700">
          {address}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {copied ? strings.inboundImportAddress.copiedLabel : strings.inboundImportAddress.copyCta}
        </button>
      </div>
    </div>
  )
}
