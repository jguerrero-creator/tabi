import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import {
  checkEntitlement,
  getEntitlements,
  type EntitlementCheck,
  type Plan,
  type PlanEntitlements,
} from './entitlements'

interface Profile {
  id: string
  plan: Plan
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchProfile() {
      setLoading(true)
      setError(null)

      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        if (!cancelled) {
          setError(userError?.message ?? 'No authenticated user')
          setLoading(false)
        }
        return
      }

      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('id, plan')
        .eq('id', userData.user.id)
        .single()

      if (cancelled) return

      if (fetchError) {
        setError(fetchError.message)
      } else {
        setProfile(data as Profile)
      }
      setLoading(false)
    }

    fetchProfile()
    return () => {
      cancelled = true
    }
  }, [])

  const entitlements: PlanEntitlements | null = profile ? getEntitlements(profile.plan) : null

  // Fails closed: an action is only ever allowed once the plan is known.
  // This is display-only (show/grey out) — the server check is what actually
  // blocks the action.
  function can(check: EntitlementCheck): boolean {
    return profile ? checkEntitlement(profile.plan, check) : false
  }

  return { profile, entitlements, can, loading, error }
}
