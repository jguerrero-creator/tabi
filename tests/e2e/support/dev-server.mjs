import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const port = Number(process.env.E2E_PORT ?? 5180)

for (const line of readFileSync(path.join(rootDir, '.env.local'), 'utf8').split('\n')) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
}

const geocodeHandler = (await import(path.join(rootDir, 'api/geocode.ts'))).default
const travelTimeHandler = (await import(path.join(rootDir, 'api/travel-time.ts'))).default
const placesPhotoHandler = (await import(path.join(rootDir, 'api/places-photo.ts'))).default
// Note: api/places-search.ts is NOT wired up here, same as api/extract-reservation.ts
// isn't — both import from ./_lib/*.js, which plain Node ESM can't resolve to the
// sibling .ts file the way Vite/Vercel's bundlers do. Its e2e coverage stubs the
// endpoint via page.route() instead (see activity-place-search.spec.ts), matching
// extraction-review-flow.spec.ts's existing precedent for the same limitation.

const vite = await createServer({
  root: rootDir,
  server: { middlewareMode: true },
  appType: 'spa',
})

const apiHandlers = {
  '/api/geocode': geocodeHandler,
  '/api/travel-time': travelTimeHandler,
  '/api/places-photo': placesPhotoHandler,
}

const server = createHttpServer(async (req, res) => {
  const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : undefined
  const handler = pathname ? apiHandlers[pathname] : undefined
  if (req.url?.startsWith('/api/')) {
    if (!handler) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: body.length ? body : undefined,
    })
    const response = await handler(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
    return
  }
  vite.middlewares(req, res)
})

server.listen(port, () => {
  console.log(`READY on http://localhost:${port}`)
})
