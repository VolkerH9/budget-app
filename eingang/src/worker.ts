// Inbox for Apple Pay payments of the Budget app.
//   POST /einrichten         app registers its public key and the two keys (only their hashes are kept)
//   POST /zahlung            shortcut, Bearer <shortcut key>: one payment or the waiting queue as text lines
//   GET  /zahlungen          app, Bearer <app key>: all waiting payments, encrypted
//   POST /zahlungen/loeschen app: payments it has stored
//   GET  /status             app: set up? how many waiting?
// Nothing is stored readable: every payment is encrypted for the app the moment it arrives.
import { hash, sealFor, type Sealed } from './crypto'

interface Env {
  DB: D1Database
}

interface Config {
  publicKey: JsonWebKey
  appHash: string
  shortcutHash: string
}

const ORIGINS = ['https://volkerh9.github.io']
/** Payments not fetched after this many days are dropped */
const KEEP_DAYS = 60

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  return allowed
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
    : {}
}

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(request) } })

const bearer = (request: Request) => (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()

async function allowed(request: Request, config: Config | null, which: 'appHash' | 'shortcutHash'): Promise<boolean> {
  const token = bearer(request)
  return !!config && token.length >= 20 && (await hash(token)) === config[which]
}

/** One payment from the shortcut: a JSON object, or a line of the queue */
function payments(body: unknown): Record<string, unknown>[] {
  if (body && typeof body === 'object' && typeof (body as { text?: unknown }).text === 'string') {
    return (body as { text: string }).text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      try {
        const parsed = JSON.parse(line)
        return parsed && typeof parsed === 'object' ? parsed : { roh: line }
      } catch {
        return { roh: line }
      }
    })
  }
  return body && typeof body === 'object' ? [body as Record<string, unknown>] : []
}

const clip = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 300) : '')

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) })
    const row = await env.DB.prepare("SELECT wert FROM einstellungen WHERE schluessel = 'config'").first<{ wert: string }>()
    const config = row ? (JSON.parse(row.wert) as Config) : null

    if (url.pathname === '/status' && request.method === 'GET') {
      if (!config) return json(request, { eingerichtet: false })
      if (!(await allowed(request, config, 'appHash'))) return json(request, { eingerichtet: true, fremd: true })
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM zahlungen').first<{ n: number }>()
      return json(request, { eingerichtet: true, offen: count?.n ?? 0 })
    }

    if (url.pathname === '/einrichten' && request.method === 'POST') {
      // The first device sets it up; changing it later needs the current app key
      if (config && !(await allowed(request, config, 'appHash'))) return json(request, { fehler: 'Der Eingang ist schon mit einem anderen Gerät verbunden.' }, 403)
      const body = await request.json<{ publicKey?: JsonWebKey; appToken?: string; shortcutToken?: string }>().catch(() => ({}))
      if (!body.publicKey?.n || !body.appToken || body.appToken.length < 20 || !body.shortcutToken || body.shortcutToken.length < 20) return json(request, { fehler: 'Unvollständig.' }, 400)
      const value = JSON.stringify({ publicKey: body.publicKey, appHash: await hash(body.appToken), shortcutHash: await hash(body.shortcutToken) } satisfies Config)
      await env.DB.prepare("INSERT INTO einstellungen (schluessel, wert) VALUES ('config', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert").bind(value).run()
      // Payments for the old key could not be opened any more
      await env.DB.prepare('DELETE FROM zahlungen').run()
      return json(request, { eingerichtet: true })
    }

    if (url.pathname === '/zahlung' && request.method === 'POST') {
      if (!(await allowed(request, config, 'shortcutHash'))) return json(request, { fehler: 'Schlüssel falsch.' }, 401)
      const body = await request.json().catch(() => null)
      const list = payments(body).slice(0, 50)
      const now = new Date().toISOString()
      for (const p of list) {
        const plain = JSON.stringify({ betrag: clip(p.betrag), haendler: clip(p.haendler), karte: clip(p.karte), name: clip(p.name), roh: clip(p.roh), datum: clip(p.datum), empfangen: now })
        const sealed = await sealFor(config!.publicKey, plain)
        await env.DB.prepare('INSERT INTO zahlungen (id, daten, erstellt) VALUES (?, ?, ?)').bind(`p:${Date.now()}:${crypto.randomUUID()}`, JSON.stringify(sealed), Date.now()).run()
      }
      await env.DB.prepare('DELETE FROM zahlungen WHERE erstellt < ?').bind(Date.now() - KEEP_DAYS * 86_400_000).run()
      return json(request, { gespeichert: list.length })
    }

    if (url.pathname === '/zahlungen' && request.method === 'GET') {
      if (!(await allowed(request, config, 'appHash'))) return json(request, { fehler: 'Schlüssel falsch.' }, 401)
      const { results } = await env.DB.prepare('SELECT id, daten FROM zahlungen ORDER BY erstellt LIMIT 200').all<{ id: string; daten: string }>()
      const items: (Sealed & { id: string })[] = results.map((r) => ({ id: r.id, ...(JSON.parse(r.daten) as Sealed) }))
      return json(request, { zahlungen: items })
    }

    if (url.pathname === '/zahlungen/loeschen' && request.method === 'POST') {
      if (!(await allowed(request, config, 'appHash'))) return json(request, { fehler: 'Schlüssel falsch.' }, 401)
      const body = await request.json<{ ids?: string[] }>().catch(() => ({}))
      const ids = (body.ids ?? []).filter((id) => typeof id === 'string' && id.startsWith('p:')).slice(0, 200)
      if (ids.length > 0) await env.DB.batch(ids.map((id) => env.DB.prepare('DELETE FROM zahlungen WHERE id = ?').bind(id)))
      return json(request, { geloescht: ids.length })
    }

    return json(request, { fehler: 'Nicht gefunden.' }, 404)
  },
}
