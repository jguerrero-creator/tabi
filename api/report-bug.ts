// Server-side only — creates a page in the Notion "Bugs" database (TABI-171)
// using the secret NOTION_API_KEY. Never call the Notion API from src/.
// See ./README.md.

const NOTION_API_URL = 'https://api.notion.com/v1/pages'
const NOTION_VERSION = '2025-09-03'
const BUGS_DATA_SOURCE_ID = '8e6d03c4-c490-4059-9084-abe6ff01e349'
const MAX_TITLE_LENGTH = 200
const MAX_TEXT_LENGTH = 2000

interface ReportBugRequestBody {
  title?: string
  description?: string
}

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const apiKey = process.env.NOTION_API_KEY
  if (!apiKey) {
    console.error('report-bug: NOTION_API_KEY is not configured')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  let body: ReportBugRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const title = body.title?.trim().slice(0, MAX_TITLE_LENGTH)
  if (!title) {
    return jsonResponse({ error: 'title is required' }, 400)
  }

  const description = body.description?.trim().slice(0, MAX_TEXT_LENGTH) ?? ''
  const environment = request.headers.get('user-agent')?.slice(0, MAX_TEXT_LENGTH) ?? 'unknown'
  const today = new Date().toISOString().slice(0, 10)

  const notionResponse = await fetch(NOTION_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: BUGS_DATA_SOURCE_ID },
      properties: {
        Titre: { title: [{ text: { content: title } }] },
        'Étapes de repro': { rich_text: description ? [{ text: { content: description } }] : [] },
        Statut: { select: { name: 'Nouveau' } },
        'Date de découverte': { date: { start: today } },
        Environnement: { rich_text: [{ text: { content: environment } }] },
      },
    }),
  })

  if (!notionResponse.ok) {
    console.error('report-bug: Notion API error', notionResponse.status, await notionResponse.text())
    return jsonResponse({ error: 'Failed to create bug report' }, 502)
  }

  return jsonResponse({ status: 'ok' }, 201)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
