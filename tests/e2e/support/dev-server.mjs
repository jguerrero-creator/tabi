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

const vite = await createServer({
  root: rootDir,
  server: { middlewareMode: true },
  appType: 'spa',
})

const apiHandlers = {
  '/api/geocode': geocodeHandler,
  '/api/travel-time': travelTimeHandler,
}

const server = createHttpServer(async (req, res) => {
  const handler = req.url ? apiHandlers[req.url] : undefined
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
