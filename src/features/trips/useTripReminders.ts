import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Reminder } from '../../types/reminder'

export interface ReminderInput {
  title: string
  date: string
}

/**
 * Fetches every reminder for a trip (TABI-104), ordered by date so callers
 * can surface the most urgent one first without re-sorting.
 */
export function useTripReminders(tripId: string) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReminders = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('reminders')
      .select('*')
      .eq('trip_id', tripId)
      .order('date', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setReminders(data ?? [])
    }
    setLoading(false)
  }, [tripId])

  useEffect(() => {
    fetchReminders()
  }, [fetchReminders])

  const createReminder = useCallback(
    async (input: ReminderInput): Promise<Reminder> => {
      const { data, error: createError } = await supabase
        .from('reminders')
        .insert({ trip_id: tripId, title: input.title, date: input.date })
        .select()
        .single()

      if (createError) throw createError
      setReminders((prev) => [...prev, data].sort((a, b) => a.date.localeCompare(b.date)))
      return data
    },
    [tripId],
  )

  const deleteReminder = useCallback(async (reminderId: string) => {
    const { error: deleteError } = await supabase.from('reminders').delete().eq('id', reminderId)
    if (deleteError) throw deleteError
    setReminders((prev) => prev.filter((reminder) => reminder.id !== reminderId))
  }, [])

  return { reminders, loading, error, createReminder, deleteReminder, refetch: fetchReminders }
}
