import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import type { Database } from '../../../src/types/database.types'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env'

/**
 * Waits for the app's own anonymous sign-in (main.tsx's ensureAnonSession) to
 * complete, then pulls the resulting tokens out of localStorage so a Node-side
 * Supabase client can authenticate as the exact same user — RLS-scoped seed
 * and cleanup, without ever using a service-role key against the real project.
 */
export async function authenticatedClientFor(page: Page): Promise<SupabaseClient<Database>> {
  const tokens = await page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      return { access_token: parsed.access_token as string, refresh_token: parsed.refresh_token as string }
    }
    return null
  })

  if (!tokens) throw new Error('No Supabase auth session found in localStorage — app did not sign in')

  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { error } = await client.auth.setSession(tokens)
  if (error) throw error

  return client
}
