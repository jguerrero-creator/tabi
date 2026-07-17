import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function loadDotEnvLocal() {
  const content = readFileSync(path.join(rootDir, '.env.local'), 'utf8')
  for (const line of content.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
  }
}

loadDotEnvLocal()

export const SUPABASE_URL = required('VITE_SUPABASE_URL')
export const SUPABASE_ANON_KEY = required('VITE_SUPABASE_ANON_KEY')

function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing ${key} in .env.local — required to run E2E tests`)
  return value
}
