// Fails the build if any server-only secret value ends up in the client bundle.
// Vite only inlines VITE_-prefixed env vars into import.meta.env by design,
// but this is a defense-in-depth check for the non-negotiable rule that no
// API key (Claude, Google Maps/Places, Resend, ...) ever reaches the browser.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const distDir = 'dist'
const serverOnlyVars = ['ANTHROPIC_API_KEY', 'GOOGLE_MAPS_API_KEY', 'RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const secrets = serverOnlyVars
  .map((name) => [name, process.env[name]])
  .filter(([, value]) => value && value.length >= 8)

if (secrets.length === 0) {
  console.log('check-no-client-secrets: no server-only secrets set in this environment, skipping scan.')
  process.exit(0)
}

const files = walk(distDir).filter((f) => /\.(js|mjs|html|css|map)$/.test(f))
const leaks = []

for (const file of files) {
  const content = readFileSync(file, 'utf8')
  for (const [name, value] of secrets) {
    if (content.includes(value)) leaks.push(`${name} found in ${file}`)
  }
}

if (leaks.length > 0) {
  console.error('client secret leak detected:\n' + leaks.join('\n'))
  process.exit(1)
}

console.log(`check-no-client-secrets: scanned ${files.length} files, no leaks found.`)
