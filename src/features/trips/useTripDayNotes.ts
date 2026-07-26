import { useCallback, useEffect, useState } from 'react'
import { logClientError } from '../../lib/logError'
import { supabase } from '../../lib/supabase'
import type { TripDayNote } from '../../types/dayNote'

/**
 * Fetches every day-level note for a trip (TABI-56), keyed by date
 * (`YYYY-MM-DD`, matching groupByDate's dateKey) so callers can look one up
 * per day without scanning the list.
 */
export function useTripDayNotes(tripId: string) {
  const [notesByDate, setNotesByDate] = useState<Map<string, TripDayNote>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase.from('trip_day_notes').select('*').eq('trip_id', tripId)

    if (fetchError) {
      logClientError('useTripDayNotes.fetchNotes', fetchError)
      setError(fetchError.message)
    } else {
      setNotesByDate(new Map((data ?? []).map((row) => [row.date, row])))
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const saveDayNote = useCallback(
    async (date: string, note: string): Promise<void> => {
      const { data, error: saveError } = await supabase
        .from('trip_day_notes')
        .upsert({ trip_id: tripId, date, note }, { onConflict: 'trip_id,date' })
        .select()
        .single()

      if (saveError) throw saveError
      setNotesByDate((prev) => new Map(prev).set(date, data))
    },
    [tripId],
  )

  const clearDayNote = useCallback(
    async (date: string) => {
      const { error: deleteError } = await supabase
        .from('trip_day_notes')
        .delete()
        .eq('trip_id', tripId)
        .eq('date', date)

      if (deleteError) throw deleteError
      setNotesByDate((prev) => {
        const next = new Map(prev)
        next.delete(date)
        return next
      })
    },
    [tripId],
  )

  return { notesByDate, loading, error, saveDayNote, clearDayNote, refetch: fetchNotes }
}
