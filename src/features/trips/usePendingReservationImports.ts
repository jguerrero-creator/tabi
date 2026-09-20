import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database.types'

export type PendingReservationImport = Database['public']['Tables']['pending_reservation_imports']['Row']

// TABI: surfaces the "extracted but not yet reviewed" state an inbound-email import
// leaves behind (api/inbound-email.ts) — the only import channel that can produce a
// result with nobody watching at the time, since it arrives from a forwarded email,
// not an active app session. Rows are only ever created by the webhook's service-role
// client; this hook only reads them and marks them reviewed once the organizer acts.
export function usePendingReservationImports(tripId: string) {
  const [pendingImports, setPendingImports] = useState<PendingReservationImport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPendingImports = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('pending_reservation_imports')
      .select('*')
      .eq('trip_id', tripId)
      .is('reviewed_at', null)
      .order('received_at', { ascending: true })

    if (fetchError) {
      logClientError('usePendingReservationImports.fetchPendingImports', fetchError)
      setError(fetchError.message)
    } else {
      setPendingImports(data ?? [])
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchPendingImports()
  }, [fetchPendingImports])

  const resolvePendingImport = useCallback(async (id: string, outcome: 'confirmed' | 'dismissed') => {
    const { error: updateError } = await supabase
      .from('pending_reservation_imports')
      .update({ reviewed_at: new Date().toISOString(), outcome })
      .eq('id', id)

    if (updateError) throw updateError
    setPendingImports((current) => current.filter((item) => item.id !== id))
  }, [])

  return { pendingImports, loading, error, resolvePendingImport, refetch: fetchPendingImports }
}
